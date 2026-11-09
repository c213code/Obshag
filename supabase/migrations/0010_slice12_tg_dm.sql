-- Slice 12: «Потом» is decided at 19:00 through a Telegram DM with buttons (and one push).
--
--   create_telegram_link_code()   authenticated; one random code (24 url-safe chars), only its sha256 is stored, 15 min,
--                                 a new code deletes the user's older ones
--   unlink_telegram()             authenticated
--   tg_link_account(secret, code, tg_user_id)         anon + server secret; consumes the code (single use), links the
--                                 Telegram id (moved if it was on another profile), returns the display name or null
--   tg_resolve_pending(secret, tg_user_id, purchase, shared)   anon + server secret; the tg user must be linked to the
--                                 PAYER of a still-pending purchase. Returns 'shared' | 'personal' | 'already_resolved' |
--                                 'too_small'; 42501 for anyone else (not found and not yours look the same).
--                                 The 0007 trigger posts a shared purchase to the group by itself.
--   run_pending_digest(secret)    anon + server secret; per payer: pending purchases older than 10 minutes that were not
--                                 digested today (Asia/Almaty), at most 10 per user, logged as sent.
--
-- The anon surface grows from 4 to 7 functions: these three, each of which raises 28000 without the 'cron' server secret
-- (the same gate as run_daily_reminders). All functions are security definer with search_path = ''.
-- profiles.telegram_user_id is readable by housemates like the rest of profiles (it equals the private chat id).

alter table public.profiles add column telegram_user_id bigint unique;

create table private.telegram_link_codes (
  code_hash  text primary key,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  expires_at timestamptz not null
);
alter table private.telegram_link_codes enable row level security;
revoke all on private.telegram_link_codes from public, anon, authenticated;

create table private.pending_digest_log (
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  sent_on     date not null,
  primary key (purchase_id, sent_on)
);
alter table private.pending_digest_log enable row level security;
revoke all on private.pending_digest_log from public, anon, authenticated;

-- ---------------------------------------------------------------- link codes

create function public.create_telegram_link_code()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_code text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'profile_required' using errcode = 'P0002';
  end if;
  delete from private.telegram_link_codes c where c.user_id = v_uid or c.expires_at < now();
  -- 18 random bytes = 24 base64 characters, made url-safe
  v_code := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  insert into private.telegram_link_codes (code_hash, user_id, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), v_uid, now() + interval '15 minutes');
  return v_code;
end;
$$;

create function public.unlink_telegram()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.profiles p set telegram_user_id = null where p.id = v_uid;
  delete from private.telegram_link_codes c where c.user_id = v_uid;
end;
$$;

create function public.tg_link_account(p_secret text, p_code text, p_tg_user_id bigint)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid;
  v_name text;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_tg_user_id is null or p_tg_user_id <= 0 or p_code is null or char_length(p_code) not between 16 and 64 then
    return null;
  end if;
  delete from private.telegram_link_codes c
  where c.code_hash = encode(extensions.digest(p_code, 'sha256'), 'hex') and c.expires_at > now()
  returning c.user_id into v_uid;
  if v_uid is null then
    return null;
  end if;
  -- the Telegram account moves to this profile if it was linked elsewhere
  update public.profiles p set telegram_user_id = null where p.telegram_user_id = p_tg_user_id and p.id <> v_uid;
  update public.profiles p set telegram_user_id = p_tg_user_id where p.id = v_uid returning p.display_name into v_name;
  return v_name;
end;
$$;

-- ---------------------------------------------------------------- resolve from a Telegram button

create function public.tg_resolve_pending(p_secret text, p_tg_user_id bigint, p_purchase uuid, p_shared boolean)
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p public.purchases;
  v_ids uuid[];
  v_today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_tg_user_id is null or p_purchase is null or p_shared is null then
    raise exception 'invalid' using errcode = '23514';
  end if;

  select * into v_p from public.purchases p where p.id = p_purchase for update;
  if not found
     or not exists (select 1 from public.profiles pr where pr.id = v_p.payer_id and pr.telegram_user_id = p_tg_user_id)
     or not exists (select 1 from public.members m where m.household_id = v_p.household_id and m.user_id = v_p.payer_id and m.active)
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_p.status <> 'pending' then
    return 'already_resolved';
  end if;

  if not p_shared then
    update public.purchases p set status = 'personal' where p.id = v_p.id;
    return 'personal';
  end if;

  -- same rule as capture_purchase 'shared': active members who are not away, everyone if that leaves nobody
  select array_agg(m.user_id order by m.joined_at, m.user_id) into v_ids
  from public.members m
  where m.household_id = v_p.household_id and m.active and (m.away_until is null or m.away_until < v_today);
  if v_ids is null then
    select array_agg(m.user_id order by m.joined_at, m.user_id) into v_ids
    from public.members m where m.household_id = v_p.household_id and m.active;
  end if;
  if v_ids is null or v_p.amount < cardinality(v_ids) then
    return 'too_small';
  end if;
  update public.purchases p
  set status = 'shared', description = coalesce(nullif(btrim(coalesce(p.merchant, '')), ''), 'Покупка')
  where p.id = v_p.id;
  perform private.insert_equal_shares(v_p.id, v_p.household_id, v_p.payer_id, v_p.amount, v_ids);
  return 'shared';
end;
$$;

-- ---------------------------------------------------------------- the 19:00 digest

create function public.run_pending_digest(p_secret text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_today date := (now() at time zone 'Asia/Almaty')::date;
  v_out jsonb := '[]'::jsonb;
  v_ids uuid[];
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  delete from private.pending_digest_log l where l.sent_on < v_today - 7;

  for r in
    select pr.id as user_id, pr.telegram_user_id
    from public.profiles pr
    where (pr.telegram_user_id is not null or exists (select 1 from public.push_subscriptions s where s.user_id = pr.id))
      and exists (
        select 1 from public.purchases p
        where p.payer_id = pr.id and p.status = 'pending' and p.created_at < now() - interval '10 minutes'
      )
    order by pr.id
  loop
    select array_agg(x.id) into v_ids from (
      select p.id from public.purchases p
      where p.payer_id = r.user_id and p.status = 'pending' and p.created_at < now() - interval '10 minutes'
        and not exists (select 1 from private.pending_digest_log l where l.purchase_id = p.id and l.sent_on = v_today)
      order by p.created_at, p.id
      limit 10
    ) x;
    continue when v_ids is null;

    insert into private.pending_digest_log (purchase_id, sent_on)
    select unnest(v_ids), v_today on conflict do nothing;

    v_out := v_out || jsonb_build_object(
      'user_id', r.user_id,
      'telegram_user_id', r.telegram_user_id,
      'subscriptions', private.subscriptions_of(r.user_id),
      'purchases', (
        select jsonb_agg(jsonb_build_object('id', p.id, 'merchant', p.merchant, 'amount', p.amount, 'created_at', p.created_at) order by p.created_at, p.id)
        from public.purchases p where p.id = any (v_ids)
      )
    );
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.create_telegram_link_code() from public, anon, authenticated;
revoke all on function public.unlink_telegram() from public, anon, authenticated;
revoke all on function public.tg_link_account(text, text, bigint) from public, anon, authenticated;
revoke all on function public.tg_resolve_pending(text, bigint, uuid, boolean) from public, anon, authenticated;
revoke all on function public.run_pending_digest(text) from public, anon, authenticated;
grant execute on function public.create_telegram_link_code() to authenticated;
grant execute on function public.unlink_telegram() to authenticated;
grant execute on function public.tg_link_account(text, text, bigint) to anon;
grant execute on function public.tg_resolve_pending(text, bigint, uuid, boolean) to anon;
grant execute on function public.run_pending_digest(text) to anon;
