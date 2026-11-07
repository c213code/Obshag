-- 0005_slice5_2: reminders (SDD §6.5), custom split, delete and edit of a purchase (SDD §5.3 screen 3, §6.3).
-- 0001-0004 are LIVE and untouched; this file only adds.
--
-- SERVER SECRET. The Next.js server has no service-role key. Instead the server RPCs that reach other users'
-- push subscriptions take `p_secret`, which must hash (sha256 hex) to the row named 'cron' in private.server_secrets.
-- This file inserts NO row: the owner inserts the hash of CRON_SECRET by hand (see README). Without that row every
-- secret-gated RPC raises 28000, so calling them from a browser is useless.
--
--   run_daily_reminders(secret)             anon (called by the cron route); picks debtors and logs the reminders
--   remind(secret, household, debtor)       authenticated creditor; 6h cooldown per pair
--   set_reminders_enabled(household, bool)  self only
--   create_purchase_custom(...)             payer; explicit amounts per person that sum to the total
--   delete_purchase(id)                     payer; blocked (23514 has_payments) once anything was paid
--   update_purchase_description(id, text)   payer; 1..200 characters
--
-- Direct client UPDATE and DELETE on purchases are revoked: these RPCs are the only way.
-- Error codes: 28000 not signed in / bad secret, 42501 not allowed, 23514 invalid / has_payments, 23503 not a member,
-- P0002 not found, P0001 rate_limited (cooldown; the HINT carries the seconds left).

-- ---------------------------------------------------------------- server secret

create table private.server_secrets (
  name text primary key,
  hash text not null
);
alter table private.server_secrets enable row level security;
revoke all on table private.server_secrets from public, anon, authenticated;

create function private.server_secret_ok(p_secret text)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select p_secret is not null and p_secret <> '' and exists (
    select 1 from private.server_secrets s
    where s.name = 'cron' and s.hash = encode(extensions.digest(p_secret, 'sha256'), 'hex')
  );
$$;
revoke all on function private.server_secret_ok(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- reminders

alter table public.members add column reminders_enabled boolean not null default true;

create function public.set_reminders_enabled(p_household uuid, p_enabled boolean)
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
  if p_enabled is null then
    raise exception 'invalid' using errcode = '23514';
  end if;
  update public.members m set reminders_enabled = p_enabled
  where m.household_id = p_household and m.user_id = v_uid and m.active;
  if not found then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
end;
$$;

create function private.subscriptions_of(p_user uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth) order by s.created_at, s.endpoint),
    '[]'::jsonb
  )
  from public.push_subscriptions s where s.user_id = p_user;
$$;
revoke all on function private.subscriptions_of(uuid) from public, anon, authenticated;

-- Debtors with a net debt older than 24h, one reminder per (creditor, debtor) pair. "Older" = the oldest open share the
-- debtor owes that creditor was created more than 24h ago. Skipped: reminders switched off, or a reminder in the last 6h.
-- `from_name_dative` carries the creditor's display name; the route puts it into the dative case.
create function public.run_daily_reminders(p_secret text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_net bigint;
  v_oldest timestamptz;
  v_out jsonb := '[]'::jsonb;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  delete from public.reminder_log where sent_at < now() - interval '7 days';

  for r in
    select d.household_id, d.user_id as debtor, c.user_id as creditor
    from public.members d
    join public.members c on c.household_id = d.household_id and c.active and c.user_id <> d.user_id
    where d.active and d.reminders_enabled
    order by d.household_id, d.user_id, c.user_id
  loop
    v_net := private.pair_net(r.household_id, r.debtor, r.creditor);
    continue when v_net <= 0;

    select min(p.created_at) into v_oldest
    from private.open_pair_shares(r.household_id, r.debtor, r.creditor) o
    join public.purchases p on p.id = o.purchase_id
    where o.debtor_id = r.debtor;
    continue when v_oldest is null or v_oldest > now() - interval '24 hours';

    continue when exists (
      select 1 from public.reminder_log l
      where l.from_id = r.creditor and l.to_id = r.debtor and l.sent_at > now() - interval '6 hours'
    );

    insert into public.reminder_log (from_id, to_id) values (r.creditor, r.debtor);
    v_out := v_out || jsonb_build_object(
      'to_user', r.debtor,
      'from_user', r.creditor,
      'from_name_dative', (select pr.display_name from public.profiles pr where pr.id = r.creditor),
      'amount', v_net,
      'subscriptions', private.subscriptions_of(r.debtor)
    );
  end loop;
  return v_out;
end;
$$;

create function public.remind(p_secret text, p_household uuid, p_debtor uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_net bigint;
  v_last timestamptz;
begin
  if v_uid is null or not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_household is null or p_debtor is null or p_debtor = v_uid or not private.is_member(p_household) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_debtor and m.active) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform private.lock_pair(p_household, v_uid, p_debtor);
  v_net := private.pair_net(p_household, p_debtor, v_uid);
  if v_net <= 0 then
    raise exception 'not a creditor' using errcode = '42501';
  end if;

  select max(l.sent_at) into v_last
  from public.reminder_log l
  where l.from_id = v_uid and l.to_id = p_debtor and l.sent_at > now() - interval '6 hours';
  if v_last is not null then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = ceil(extract(epoch from (v_last + interval '6 hours' - now())))::int::text;
  end if;

  insert into public.reminder_log (from_id, to_id) values (v_uid, p_debtor);
  return jsonb_build_object(
    'to_user', p_debtor,
    'from_user', v_uid,
    'from_name_dative', (select pr.display_name from public.profiles pr where pr.id = v_uid),
    'amount', v_net,
    'subscriptions', private.subscriptions_of(p_debtor)
  );
end;
$$;

-- ---------------------------------------------------------------- custom split

create function public.create_purchase_custom(
  p_household uuid,
  p_amount integer,
  p_description text,
  p_merchant text,
  p_shares jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_desc text := btrim(coalesce(p_description, ''));
  v_merchant text := nullif(btrim(coalesce(p_merchant, '')), '');
  v_id uuid;
  v_e jsonb;
  v_user uuid;
  v_amt integer;
  v_seen uuid[] := '{}';
  v_sum bigint := 0;
  v_other boolean := false;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'amount must be 1..10000000' using errcode = '23514';
  end if;
  if char_length(v_desc) not between 1 and 200 or char_length(coalesce(v_merchant, '')) > 120 then
    raise exception 'invalid description' using errcode = '23514';
  end if;
  if p_shares is null or jsonb_typeof(p_shares) <> 'array' or jsonb_array_length(p_shares) not between 1 and 50 then
    raise exception 'between 1 and 50 entries' using errcode = '23514';
  end if;

  for v_e in select e from jsonb_array_elements(p_shares) as e loop
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e -> 'user_id') <> 'string'
       or (v_e ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_e -> 'amount') <> 'number'
       or (v_e ->> 'amount') !~ '^[0-9]{1,8}$' then
      raise exception 'invalid entry' using errcode = '23514';
    end if;
    v_user := (v_e ->> 'user_id')::uuid;
    v_amt := (v_e ->> 'amount')::integer;
    if v_user = any (v_seen) then
      raise exception 'duplicate entry' using errcode = '23514';
    end if;
    v_seen := v_seen || v_user;
    if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = v_user and m.active) then
      raise exception 'every entry must be an active member' using errcode = '23503';
    end if;
    v_sum := v_sum + v_amt;
    if v_user <> v_uid then
      v_other := true;
    end if;
  end loop;

  if v_sum <> p_amount then
    raise exception 'amounts must add up to the total' using errcode = '23514';
  end if;
  if not v_other then
    raise exception 'at least one entry must not be the payer' using errcode = '23514';
  end if;

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status)
  values (p_household, v_uid, p_amount, v_desc, v_merchant, 'manual', 'shared')
  returning id into v_id;

  insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at)
  select v_id, p_household, (e ->> 'user_id')::uuid, (e ->> 'amount')::integer,
         case when (e ->> 'user_id')::uuid = v_uid then now() end
  from jsonb_array_elements(p_shares) as e;

  return private.purchase_json(v_id);
end;
$$;

-- ---------------------------------------------------------------- delete and edit

create function public.delete_purchase(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_p from public.purchases p where p.id = p_id for update;
  if not found or not private.is_member(v_p.household_id) or (v_p.status <> 'shared' and v_p.payer_id <> v_uid) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if v_p.payer_id <> v_uid then
    raise exception 'only the payer can delete' using errcode = '42501';
  end if;
  if exists (select 1 from public.shares s where s.purchase_id = p_id and s.settled_at is not null and s.debtor_id <> v_p.payer_id)
     or exists (
       select 1 from public.settlement_shares ss
       join public.settlements st on st.id = ss.settlement_id
       where ss.purchase_id = p_id and st.status <> 'cancelled'
     ) then
    raise exception 'has_payments' using errcode = '23514';
  end if;
  delete from public.purchases where id = p_id;
end;
$$;

create function public.update_purchase_description(p_id uuid, p_text text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_text text := btrim(coalesce(p_text, ''));
  v_p public.purchases;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_p from public.purchases p where p.id = p_id for update;
  if not found or not private.is_member(v_p.household_id) or (v_p.status <> 'shared' and v_p.payer_id <> v_uid) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if v_p.payer_id <> v_uid then
    raise exception 'only the payer can edit' using errcode = '42501';
  end if;
  if char_length(v_text) not between 1 and 200 then
    raise exception 'invalid description' using errcode = '23514';
  end if;
  update public.purchases set description = v_text where id = p_id;
  return private.purchase_json(p_id);
end;
$$;

-- ---------------------------------------------------------------- grants

revoke delete on public.purchases from authenticated;
revoke update on public.purchases from authenticated;
revoke update (description, merchant) on public.purchases from authenticated;
drop policy purchases_update on public.purchases;
drop policy purchases_delete on public.purchases;

revoke all on function public.set_reminders_enabled(uuid, boolean) from public, anon, authenticated;
revoke all on function public.run_daily_reminders(text) from public, anon, authenticated;
revoke all on function public.remind(text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.create_purchase_custom(uuid, integer, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.delete_purchase(uuid) from public, anon, authenticated;
revoke all on function public.update_purchase_description(uuid, text) from public, anon, authenticated;

grant execute on function public.run_daily_reminders(text) to anon;
grant execute on function public.set_reminders_enabled(uuid, boolean) to authenticated;
grant execute on function public.remind(text, uuid, uuid) to authenticated;
grant execute on function public.create_purchase_custom(uuid, integer, text, text, jsonb) to authenticated;
grant execute on function public.delete_purchase(uuid) to authenticated;
grant execute on function public.update_purchase_description(uuid, text) to authenticated;
