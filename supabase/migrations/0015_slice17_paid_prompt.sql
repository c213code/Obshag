-- Slice 17: «Ты перевёл?» replaces the «Я оплатил» button. Opening Kaspi records a prompt; the debtor is asked when they
-- come back (sheet in the PWA) or ~2.5 minutes later (Telegram DM, else a push). 0001-0014 are live and untouched.
--
--   public.paid_prompts            one row per «opened Kaspi»; at most ONE pending per (household, from_user, to_user).
--                                  RLS: a row is visible to its from_user only. No client writes: RPCs only.
--   open_paid_prompt(hh, to)       authenticated debtor; net must owe >= 100 (too_small below, 23514 when nothing is owed).
--                                  Re-opening refreshes opened_at / amount and clears asked_at.
--   my_paid_prompts(hh)            my pending prompts of a household (older than 30 minutes are expired first).
--   answer_paid_prompt(p, yes)     the owner answers: yes = mark the settlement (same rules as mark_settlement, idempotent)
--                                  and status yes; no = status no. Returns marked | no | already | expired | stale | too_small.
--   paid_prompt_notice(secret, p)  authenticated owner + server secret; called by the delayed job. ask = true only when the
--                                  prompt is still pending, was opened at least 120 s ago and was not asked yet; it then
--                                  sets asked_at and returns who to DM / push.
--   tg_answer_paid(secret, tg, p, yes)   anon + server secret (the 10th anon function); the linked Telegram user must be
--                                  the prompt's from_user (42501 otherwise). Same answer logic as answer_paid_prompt.
-- All functions are security definer with search_path = ''.

create table public.paid_prompts (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  from_user    uuid not null references public.profiles(id) on delete cascade,
  to_user      uuid not null references public.profiles(id) on delete cascade,
  amount       integer not null check (amount > 0),
  opened_at    timestamptz not null default now(),
  status       text not null default 'pending' check (status in ('pending', 'yes', 'no', 'expired')),
  asked_at     timestamptz,
  check (from_user <> to_user)
);
create unique index paid_prompts_one_pending on public.paid_prompts (household_id, from_user, to_user) where status = 'pending';
create index paid_prompts_from_idx on public.paid_prompts (from_user, status);

alter table public.paid_prompts enable row level security;
create policy paid_prompts_select on public.paid_prompts for select to authenticated using (from_user = auth.uid());
revoke all on public.paid_prompts from public, anon, authenticated;
grant select on public.paid_prompts to authenticated;

-- ---------------------------------------------------------------- helpers

create function private.paid_prompt_expire()
returns void
language sql
security definer
set search_path = ''
as $$
  update public.paid_prompts p set status = 'expired' where p.status = 'pending' and p.opened_at < now() - interval '30 minutes'
$$;
revoke all on function private.paid_prompt_expire() from public, anon, authenticated;

-- mark_settlement (0011) for an explicit actor: the Telegram button has no auth.uid(). Same checks, same rate limit.
create function private.mark_settlement_for(p_uid uuid, p_household_id uuid, p_to uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.settlements;
  v_net bigint;
begin
  if p_uid is null or p_household_id is null or p_to is null
     or not exists (select 1 from public.members m where m.household_id = p_household_id and m.user_id = p_uid and m.active) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_to = p_uid then
    raise exception 'cannot settle with yourself' using errcode = '23514';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household_id and m.user_id = p_to and m.active) then
    raise exception 'counterparty is not an active member' using errcode = '23503';
  end if;

  perform private.lock_pair(p_household_id, p_uid, p_to);
  perform private.check_settlement_rate(p_uid);

  v_net := private.pair_net(p_household_id, p_uid, p_to);
  if v_net > 0 and v_net < private.min_transfer() then
    raise exception 'too_small' using errcode = 'P0001';
  end if;

  select * into v_row from public.settlements st
  where st.household_id = p_household_id and st.from_id = p_uid and st.to_id = p_to and st.status = 'marked'
  order by st.marked_at desc, st.id
  limit 1
  for update;
  if found then
    return private.record_settlement_shares(v_row.id);
  end if;

  if v_net <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;

  insert into public.settlements (household_id, from_id, to_id, amount, status)
  values (p_household_id, p_uid, p_to, 1, 'marked')
  returning * into v_row;
  return private.record_settlement_shares(v_row.id);
end;
$$;
revoke all on function private.mark_settlement_for(uuid, uuid, uuid) from public, anon, authenticated;

-- The one answer path (sheet and Telegram). p_actor is already authenticated by the caller.
create function private.paid_prompt_answer(p_actor uuid, p_prompt uuid, p_yes boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p public.paid_prompts;
  v_net bigint;
  v_to_name text;
begin
  select * into v_p from public.paid_prompts p where p.id = p_prompt for update;
  if not found or v_p.from_user <> p_actor then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select pr.display_name into v_to_name from public.profiles pr where pr.id = v_p.to_user;

  if v_p.status = 'pending' and v_p.opened_at < now() - interval '30 minutes' then
    update public.paid_prompts p set status = 'expired' where p.id = v_p.id;
    return jsonb_build_object('result', 'expired', 'to_name', v_to_name);
  end if;
  if v_p.status <> 'pending' then
    return jsonb_build_object('result', case when v_p.status = 'expired' then 'expired' else 'already' end, 'to_name', v_to_name);
  end if;

  if not p_yes then
    update public.paid_prompts p set status = 'no' where p.id = v_p.id;
    return jsonb_build_object('result', 'no', 'to_name', v_to_name);
  end if;

  perform private.lock_pair(v_p.household_id, v_p.from_user, v_p.to_user);
  v_net := private.pair_net(v_p.household_id, v_p.from_user, v_p.to_user);
  if v_net <= 0 or not exists (
    select 1 from public.members m where m.household_id = v_p.household_id and m.user_id = v_p.to_user and m.active
  ) then
    update public.paid_prompts p set status = 'expired' where p.id = v_p.id;
    return jsonb_build_object('result', 'stale', 'to_name', v_to_name);
  end if;
  if v_net < private.min_transfer() then
    update public.paid_prompts p set status = 'expired' where p.id = v_p.id;
    return jsonb_build_object('result', 'too_small', 'to_name', v_to_name);
  end if;

  -- an already marked settlement of this pair counts (the PWA may have marked it first): no second rate-limit hit
  if not exists (
    select 1 from public.settlements st
    where st.household_id = v_p.household_id and st.from_id = v_p.from_user and st.to_id = v_p.to_user and st.status = 'marked'
  ) then
    perform private.mark_settlement_for(v_p.from_user, v_p.household_id, v_p.to_user);
  end if;
  update public.paid_prompts p set status = 'yes' where p.id = v_p.id;
  return jsonb_build_object('result', 'marked', 'to_name', v_to_name);
end;
$$;
revoke all on function private.paid_prompt_answer(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- open / read / answer (signed in)

create function public.open_paid_prompt(p_household uuid, p_to uuid)
returns public.paid_prompts
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_net bigint;
  v_row public.paid_prompts;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or p_to is null or not private.is_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_to = v_uid then
    raise exception 'cannot settle with yourself' using errcode = '23514';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_to and m.active) then
    raise exception 'counterparty is not an active member' using errcode = '23503';
  end if;

  perform private.lock_pair(p_household, v_uid, p_to);
  v_net := private.pair_net(p_household, v_uid, p_to);
  if v_net <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;
  if v_net < private.min_transfer() then
    raise exception 'too_small' using errcode = 'P0001';
  end if;

  perform private.paid_prompt_expire();
  update public.paid_prompts p
  set opened_at = now(), amount = v_net, asked_at = null
  where p.household_id = p_household and p.from_user = v_uid and p.to_user = p_to and p.status = 'pending'
  returning * into v_row;
  if not found then
    insert into public.paid_prompts (household_id, from_user, to_user, amount)
    values (p_household, v_uid, p_to, v_net)
    returning * into v_row;
  end if;
  -- old answered rows are not needed for anything
  delete from public.paid_prompts p where p.from_user = v_uid and p.status <> 'pending' and p.opened_at < now() - interval '7 days';
  return v_row;
end;
$$;

create function public.my_paid_prompts(p_household uuid)
returns setof public.paid_prompts
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or not private.is_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  perform private.paid_prompt_expire();
  return query
    select * from public.paid_prompts p
    where p.household_id = p_household and p.from_user = v_uid and p.status = 'pending'
    order by p.opened_at desc, p.id;
end;
$$;

create function public.answer_paid_prompt(p_prompt uuid, p_yes boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_prompt is null or p_yes is null then
    raise exception 'invalid' using errcode = '23514';
  end if;
  return private.paid_prompt_answer(v_uid, p_prompt, p_yes);
end;
$$;

-- ---------------------------------------------------------------- the delayed job

create function public.paid_prompt_notice(p_secret text, p_prompt uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.paid_prompts;
begin
  if v_uid is null or not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select * into v_p from public.paid_prompts p where p.id = p_prompt for update;
  if not found or v_p.from_user <> v_uid then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform private.paid_prompt_expire();
  select * into v_p from public.paid_prompts p where p.id = p_prompt;
  -- a newer open of the same pair refreshed opened_at: its own delayed job asks later
  if v_p.status <> 'pending' or v_p.asked_at is not null or v_p.opened_at > now() - interval '120 seconds' then
    return jsonb_build_object('ask', false);
  end if;
  update public.paid_prompts p set asked_at = now() where p.id = v_p.id;
  return jsonb_build_object(
    'ask', true,
    'prompt_id', v_p.id,
    'household_id', v_p.household_id,
    'to_user', v_p.to_user,
    'to_name', (select pr.display_name from public.profiles pr where pr.id = v_p.to_user),
    'to_username', (select pr.telegram_username from public.profiles pr where pr.id = v_p.to_user),
    'amount', v_p.amount,
    'telegram_user_id', (select pr.telegram_user_id from public.profiles pr where pr.id = v_uid),
    'subscriptions', private.subscriptions_of(v_uid)
  );
end;
$$;

-- ---------------------------------------------------------------- Telegram buttons

create function public.tg_answer_paid(p_secret text, p_tg_user_id bigint, p_prompt uuid, p_yes boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_tg_user_id is null or p_prompt is null or p_yes is null then
    raise exception 'invalid' using errcode = '23514';
  end if;
  select pr.id into v_actor from public.profiles pr where pr.telegram_user_id = p_tg_user_id;
  if v_actor is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.paid_prompt_answer(v_actor, p_prompt, p_yes);
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.open_paid_prompt(uuid, uuid), public.my_paid_prompts(uuid), public.answer_paid_prompt(uuid, boolean),
  public.paid_prompt_notice(text, uuid), public.tg_answer_paid(text, bigint, uuid, boolean) from public, anon, authenticated;
grant execute on function public.open_paid_prompt(uuid, uuid), public.my_paid_prompts(uuid), public.answer_paid_prompt(uuid, boolean),
  public.paid_prompt_notice(text, uuid) to authenticated;
grant execute on function public.tg_answer_paid(text, bigint, uuid, boolean) to anon;
