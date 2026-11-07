-- 0006_slice6_7: monthly bills (SDD §6.6) and the Квартира tab (member roles, leaving, invite code, away).
-- 0001-0005 are LIVE and untouched; this file only adds.
--
--   upsert_bill / delete_bill            admin only; payer and participants must be active members
--   set_bill_amount(bill, month, amount) payer or admin; a VARIABLE bill's amount for a month creates that month's purchase
--   run_monthly_bills(secret)            anon + server secret (the daily cron); idempotent per bill and month
--   set_member_role / remove_member      admin only; removing needs a zero net with everyone (23514 not_settled)
--   leave_household                      myself; same zero-net rule
--   rotate_invite_code                   admin only
--   set_away                             myself
--
-- "Today" is the Asia/Almaty calendar day. The generator body lives in private.generate_bills(now) so tests can move the
-- clock; the public wrapper passes now().
-- Error codes: 28000 not signed in / bad secret, 42501 not allowed, 23514 invalid / not_settled / not_due,
-- 23503 not an active member, P0002 not found.

-- ---------------------------------------------------------------- schema

alter table public.bills add column participants uuid[] not null default '{}';
alter table public.purchases add column bill_id uuid references public.bills(id) on delete set null;
alter table public.purchases add column bill_month text check (bill_month is null or bill_month ~ '^\d{4}-\d{2}$');
create unique index purchases_bill_month_key on public.purchases (bill_id, bill_month) where bill_id is not null;

-- clients read bills; every write goes through the RPCs
revoke insert, update, delete on public.bills from authenticated;
drop policy bills_all on public.bills;
create policy bills_select on public.bills for select to authenticated using (private.is_member(household_id));

-- ---------------------------------------------------------------- helpers

create function private.almaty_month(p_now timestamptz)
returns text
language sql immutable
set search_path = ''
as $$ select to_char(p_now at time zone 'Asia/Almaty', 'YYYY-MM') $$;

create function private.almaty_day(p_now timestamptz)
returns integer
language sql immutable
set search_path = ''
as $$ select extract(day from (p_now at time zone 'Asia/Almaty'))::integer $$;

revoke all on function private.almaty_month(timestamptz), private.almaty_day(timestamptz) from public, anon, authenticated;

create function private.require_admin(p_household uuid)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (
    select 1 from public.members m
    where m.household_id = p_household and m.user_id = v_uid and m.active and m.role = 'admin'
  ) then
    raise exception 'admins only' using errcode = '42501';
  end if;
  return v_uid;
end;
$$;
revoke all on function private.require_admin(uuid) from public, anon, authenticated;

-- A bill's purchase for one month: fixed `p_amount`, equal split among the participants who are still active.
-- Returns null when nothing could be created (payer gone, nobody left, amount smaller than the headcount).
create function private.create_bill_purchase(p_bill public.bills, p_month text, p_amount integer)
returns uuid
language plpgsql security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
  v_id uuid;
begin
  if not exists (
    select 1 from public.members m where m.household_id = p_bill.household_id and m.user_id = p_bill.payer_id and m.active
  ) then
    return null;
  end if;
  select coalesce(array_agg(x order by o), '{}') into v_ids
  from unnest(p_bill.participants) with ordinality as u(x, o)
  where exists (select 1 from public.members m where m.household_id = p_bill.household_id and m.user_id = x and m.active);
  if cardinality(v_ids) < 1 or p_amount < cardinality(v_ids) or p_amount not between 1 and 10000000 then
    return null;
  end if;

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status, bill_id, bill_month)
  values (p_bill.household_id, p_bill.payer_id, p_amount, p_bill.title, null, 'monthly', 'shared', p_bill.id, p_month)
  on conflict (bill_id, bill_month) where bill_id is not null do nothing
  returning id into v_id;
  if v_id is null then
    return null;
  end if;
  perform private.insert_equal_shares(v_id, p_bill.household_id, p_bill.payer_id, p_amount, v_ids);
  return v_id;
end;
$$;
revoke all on function private.create_bill_purchase(public.bills, text, integer) from public, anon, authenticated;

-- ---------------------------------------------------------------- generation

-- For every bill due this month and not generated yet. Fixed: the purchase. Variable: nothing, a notice for the payer.
create function private.generate_bills(p_now timestamptz)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_month text := private.almaty_month(p_now);
  v_day integer := private.almaty_day(p_now);
  b public.bills;
  v_created integer := 0;
  v_notices jsonb := '[]'::jsonb;
begin
  for b in
    select * from public.bills x
    where x.day_of_month <= v_day and (x.last_generated_month is null or x.last_generated_month < v_month)
    order by x.id
    for update
  loop
    if b.variable then
      v_notices := v_notices || jsonb_build_object(
        'to_user', b.payer_id,
        'bill_id', b.id,
        'title', b.title,
        'month', v_month,
        'subscriptions', private.subscriptions_of(b.payer_id)
      );
    elsif b.amount is not null then
      if private.create_bill_purchase(b, v_month, b.amount) is not null then
        v_created := v_created + 1;
      end if;
      update public.bills set last_generated_month = v_month where id = b.id;
    end if;
  end loop;
  return jsonb_build_object('created', v_created, 'notices', v_notices);
end;
$$;
revoke all on function private.generate_bills(timestamptz) from public, anon, authenticated;

create function public.run_monthly_bills(p_secret text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  return private.generate_bills(now());
end;
$$;

-- ---------------------------------------------------------------- bills

create function public.upsert_bill(
  p_household uuid, p_id uuid, p_title text, p_icon text, p_amount integer, p_variable boolean,
  p_day integer, p_payer uuid, p_participants uuid[]
)
returns public.bills
language plpgsql security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_n integer := coalesce(cardinality(p_participants), 0);
  v_row public.bills;
begin
  perform private.require_admin(p_household);
  if char_length(v_title) not between 1 and 60
     or p_icon is null or p_icon not in ('home', 'drop', 'wifi', 'bolt', 'other')
     or p_variable is null
     or p_day is null or p_day not between 1 and 28 then
    raise exception 'invalid bill' using errcode = '23514';
  end if;
  if p_variable then
    if p_amount is not null then
      raise exception 'a variable bill has no fixed amount' using errcode = '23514';
    end if;
  elsif p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'amount must be 1..10000000' using errcode = '23514';
  end if;
  if v_n < 1 or v_n > 50 or (select count(distinct x) from unnest(p_participants) as x) <> v_n then
    raise exception 'participants must be 1..50 distinct members' using errcode = '23514';
  end if;
  if not p_variable and p_amount < v_n then
    raise exception 'amount is smaller than the number of participants' using errcode = '23514';
  end if;
  if p_payer is null
     or not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_payer and m.active)
     or exists (
       select 1 from unnest(p_participants) as x
       where not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = x and m.active)
     ) then
    raise exception 'payer and participants must be active members' using errcode = '23503';
  end if;

  if p_id is null then
    insert into public.bills (household_id, title, icon, amount, variable, day_of_month, payer_id, participants)
    values (p_household, v_title, p_icon, p_amount, p_variable, p_day, p_payer, p_participants)
    returning * into v_row;
  else
    update public.bills set title = v_title, icon = p_icon, amount = p_amount, variable = p_variable,
      day_of_month = p_day, payer_id = p_payer, participants = p_participants
    where id = p_id and household_id = p_household
    returning * into v_row;
    if not found then
      raise exception 'bill not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$$;

create function public.delete_bill(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_household uuid;
begin
  select household_id into v_household from public.bills where id = p_id;
  if v_household is null then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  perform private.require_admin(v_household);
  delete from public.bills where id = p_id; -- generated purchases stay (bill_id is set to null)
end;
$$;

-- The payer (or an admin) enters the amount of a VARIABLE bill for a month that is due and not generated yet.
create function public.set_bill_amount(p_bill uuid, p_month text, p_amount integer)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  b public.bills;
  v_now_month text := private.almaty_month(now());
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into b from public.bills x where x.id = p_bill for update;
  if not found or not private.is_member(b.household_id) then
    raise exception 'bill not found' using errcode = 'P0002';
  end if;
  if b.payer_id <> v_uid and not exists (
    select 1 from public.members m where m.household_id = b.household_id and m.user_id = v_uid and m.active and m.role = 'admin'
  ) then
    raise exception 'payer or admin only' using errcode = '42501';
  end if;
  if not b.variable or p_month is null or p_month !~ '^\d{4}-(0[1-9]|1[0-2])$'
     or p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'invalid' using errcode = '23514';
  end if;
  -- due = an earlier month, or this month on or after the bill's day
  if p_month > v_now_month or (p_month = v_now_month and private.almaty_day(now()) < b.day_of_month) then
    raise exception 'not_due' using errcode = '23514';
  end if;
  -- no back-dating: only this month and the two before it
  if p_month < private.almaty_month(now() - interval '2 months') then
    raise exception 'too_old' using errcode = '23514';
  end if;
  if exists (select 1 from public.purchases p where p.bill_id = b.id and p.bill_month = p_month) then
    raise exception 'already generated' using errcode = '23514';
  end if;
  v_id := private.create_bill_purchase(b, p_month, p_amount);
  if v_id is null then
    raise exception 'the bill cannot be split now' using errcode = '23514';
  end if;
  update public.bills set last_generated_month = greatest(coalesce(last_generated_month, ''), p_month) where id = b.id;
  return private.purchase_json(v_id);
end;
$$;

-- ---------------------------------------------------------------- Квартира

-- Net with everyone in the household (active or not): non-zero with anyone means "settle up first".
create function private.has_open_net(p_household uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = p_household and m.user_id <> p_user
      and private.pair_net(p_household, p_user, m.user_id) <> 0
  );
$$;
revoke all on function private.has_open_net(uuid, uuid) from public, anon, authenticated;

-- A member who goes: their share of future bills goes with them, and their bills pass to the household's first other admin.
create function private.detach_member(p_household uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  update public.bills set participants = array_remove(participants, p_user)
  where household_id = p_household and p_user = any (participants);
  update public.bills set payer_id = (
    select m.user_id from public.members m
    where m.household_id = p_household and m.user_id <> p_user and m.active and m.role = 'admin'
    order by m.joined_at, m.user_id limit 1
  )
  where household_id = p_household and payer_id = p_user
    and exists (select 1 from public.members m where m.household_id = p_household and m.user_id <> p_user and m.active and m.role = 'admin');
  update public.profiles set default_household_id = null where id = p_user and default_household_id = p_household;
end;
$$;
revoke all on function private.detach_member(uuid, uuid) from public, anon, authenticated;

create function public.set_member_role(p_household uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  perform private.require_admin(p_household);
  -- serialize membership changes per household so the last-admin guard can't be raced
  perform 1 from public.households h where h.id = p_household for update;
  if p_role is null or p_role not in ('admin', 'member') then
    raise exception 'invalid role' using errcode = '23514';
  end if;
  -- the last-admin trigger of 0001 refuses to demote the only admin
  update public.members set role = p_role where household_id = p_household and user_id = p_user and active;
  if not found then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
end;
$$;

create function public.remove_member(p_household uuid, p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := private.require_admin(p_household);
begin
  perform 1 from public.households h where h.id = p_household for update;
  if p_user is null or p_user = v_uid then
    raise exception 'use leave_household for yourself' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_user and m.active) then
    raise exception 'member not found' using errcode = 'P0002';
  end if;
  if private.has_open_net(p_household, p_user) then
    raise exception 'not_settled' using errcode = '23514';
  end if;
  perform private.detach_member(p_household, p_user);
  update public.members set active = false where household_id = p_household and user_id = p_user;
end;
$$;

create function public.leave_household(p_household uuid)
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
  perform 1 from public.households h where h.id = p_household for update;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = v_uid and m.active) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if private.has_open_net(p_household, v_uid) then
    raise exception 'not_settled' using errcode = '23514';
  end if;
  perform private.detach_member(p_household, v_uid);
  -- the last-admin trigger keeps the only admin from leaving
  update public.members set active = false where household_id = p_household and user_id = v_uid;
end;
$$;

create function public.rotate_invite_code(p_household uuid)
returns public.households
language plpgsql security definer
set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(12);
  v_code text := '';
  v_row public.households;
begin
  perform private.require_admin(p_household);
  for i in 0..11 loop
    v_code := v_code || substr(v_alphabet, 1 + (get_byte(v_bytes, i) % 32), 1);
  end loop;
  update public.households set invite_code = v_code where id = p_household returning * into v_row;
  return v_row;
end;
$$;

-- p_until null = I am home. A date in the past is refused.
create function public.set_away(p_household uuid, p_until date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_until is not null and (p_until < v_today or p_until > v_today + 366) then
    raise exception 'invalid date' using errcode = '23514';
  end if;
  update public.members set away_until = p_until where household_id = p_household and user_id = v_uid and active;
  if not found then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.upsert_bill(uuid, uuid, text, text, integer, boolean, integer, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.delete_bill(uuid) from public, anon, authenticated;
revoke all on function public.set_bill_amount(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.run_monthly_bills(text) from public, anon, authenticated;
revoke all on function public.set_member_role(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.remove_member(uuid, uuid) from public, anon, authenticated;
revoke all on function public.leave_household(uuid) from public, anon, authenticated;
revoke all on function public.rotate_invite_code(uuid) from public, anon, authenticated;
revoke all on function public.set_away(uuid, date) from public, anon, authenticated;

grant execute on function public.run_monthly_bills(text) to anon;
grant execute on function public.upsert_bill(uuid, uuid, text, text, integer, boolean, integer, uuid, uuid[]) to authenticated;
grant execute on function public.delete_bill(uuid) to authenticated;
grant execute on function public.set_bill_amount(uuid, text, integer) to authenticated;
grant execute on function public.set_member_role(uuid, uuid, text) to authenticated;
grant execute on function public.remove_member(uuid, uuid) to authenticated;
grant execute on function public.leave_household(uuid) to authenticated;
grant execute on function public.rotate_invite_code(uuid) to authenticated;
grant execute on function public.set_away(uuid, date) to authenticated;
