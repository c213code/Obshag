-- Slice 18: «+ Заказ» inside a shared purchase, «Кто платил?» for water, an admin / payer edit of a purchase.
-- 0001-0015 are LIVE and untouched; this file only adds (and replaces two functions with compatible signatures).
--
-- Orders: public.purchase_orders (purchase, person, amount, note). Shares stay the single source of truth for balances:
--   rest = total - sum(orders)  is split equally among the participants (private.insert_equal_shares rule, remainder to
--   non-payers in participant order), and every person's share = equal part + own orders. A person who ordered need not be a
--   participant. The payer cannot order from himself. rest must be >= the number of participants (every one owes >= 1).
-- RPCs (security definer, search_path = '', actor auth.uid(), authenticated only; the anon surface stays 10):
--   create_purchase_with_orders, resolve_pending_with_orders, update_purchase.
-- water_brought gets a third parameter p_payer (default null = the caller); the old two-argument calls keep working.
-- Telegram: tg_purchase_message gets «+ заказ» lines; update_purchase posts «✏️ Исправлено: old -> new» once per edit
--   (private.telegram_sent kind 'purchase_edit', a fresh uuid per edit), never breaking the transaction.
-- Errors: 23514 invalid input / has_payments / not_editable, 23503 not an active member, 42501 not allowed, P0002 not found.

-- ---------------------------------------------------------------- table

create table public.purchase_orders (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  purchase_id  uuid not null,
  household_id uuid not null,
  user_id      uuid not null,
  amount       integer not null check (amount > 0),
  note         text check (note is null or char_length(note) <= 60),
  foreign key (purchase_id, household_id) references public.purchases(id, household_id) on delete cascade,
  foreign key (household_id, user_id) references public.members(household_id, user_id)
);
create index purchase_orders_purchase_idx on public.purchase_orders(purchase_id);

alter table public.purchase_orders enable row level security;
revoke all on table public.purchase_orders from public, anon, authenticated;
grant select on public.purchase_orders to authenticated;
create policy purchase_orders_select on public.purchase_orders for select to authenticated
  using (private.can_see_purchase(purchase_id));

-- telegram dedupe: one more kind
alter table private.telegram_sent drop constraint telegram_sent_kind_check;
alter table private.telegram_sent add constraint telegram_sent_kind_check
  check (kind in ('purchase', 'settlement', 'purchase_edit'));

-- ---------------------------------------------------------------- purchase_json with orders (same signature)

create or replace function private.purchase_json(p_purchase_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select to_jsonb(p) || jsonb_build_object(
    'shares',
    coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'purchase_id', s.purchase_id, 'debtor_id', s.debtor_id, 'amount', s.amount,
           'settled_at', s.settled_at, 'settlement_id', s.settlement_id
         ) order by s.debtor_id)
       from public.shares s where s.purchase_id = p.id),
      '[]'::jsonb
    ),
    'orders',
    coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'purchase_id', o.purchase_id, 'user_id', o.user_id, 'amount', o.amount, 'note', o.note
         ) order by o.seq)
       from public.purchase_orders o where o.purchase_id = p.id),
      '[]'::jsonb
    )
  )
  from public.purchases p
  where p.id = p_purchase_id;
$$;

-- ---------------------------------------------------------------- order helpers

-- Validates the orders array and returns its sum. Nothing is written.
create function private.check_orders(p_household uuid, p_payer uuid, p_total integer, p_orders jsonb)
returns bigint
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_e jsonb;
  v_user uuid;
  v_sum bigint := 0;
begin
  if p_orders is null or jsonb_typeof(p_orders) <> 'array' then
    raise exception 'orders must be an array' using errcode = '23514';
  end if;
  if jsonb_array_length(p_orders) > 20 then
    raise exception 'at most 20 orders' using errcode = '23514';
  end if;
  for v_e in select e from jsonb_array_elements(p_orders) as e loop
    if jsonb_typeof(v_e) <> 'object'
       or jsonb_typeof(v_e -> 'user_id') <> 'string'
       or (v_e ->> 'user_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_e -> 'amount') <> 'number'
       or (v_e ->> 'amount') !~ '^[0-9]{1,8}$'
       or (v_e ->> 'amount')::integer < 1
       or (v_e -> 'note' is not null and jsonb_typeof(v_e -> 'note') not in ('string', 'null'))
       or char_length(coalesce(btrim(v_e ->> 'note'), '')) > 60 then
      raise exception 'invalid order' using errcode = '23514';
    end if;
    v_user := (v_e ->> 'user_id')::uuid;
    if v_user = p_payer then
      raise exception 'the payer cannot order from himself' using errcode = '23514';
    end if;
    if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = v_user and m.active) then
      raise exception 'every order must be from an active member' using errcode = '23503';
    end if;
    v_sum := v_sum + (v_e ->> 'amount')::integer;
  end loop;
  if v_sum >= p_total then
    raise exception 'orders must leave something to split' using errcode = '23514';
  end if;
  return v_sum;
end;
$$;

-- Writes the orders and the shares (equal part of the rest + own orders). Orders were checked by check_orders.
create function private.insert_shares_with_orders(
  p_purchase_id uuid, p_household uuid, p_payer uuid, p_amount integer, p_participant_ids uuid[], p_orders jsonb
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_sum bigint := private.check_orders(p_household, p_payer, p_amount, p_orders);
  v_rest integer := p_amount - v_sum;
  v_n integer;
  v_base integer;
  v_rem integer;
begin
  perform private.check_participants(p_household, v_rest, p_participant_ids);
  v_n := cardinality(p_participant_ids);
  v_base := v_rest / v_n;
  v_rem := v_rest - v_base * v_n;

  insert into public.purchase_orders (purchase_id, household_id, user_id, amount, note)
  select p_purchase_id, p_household, (e ->> 'user_id')::uuid, (e ->> 'amount')::integer, nullif(btrim(e ->> 'note'), '')
  from jsonb_array_elements(p_orders) with ordinality as t(e, ord)
  order by ord;

  insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at)
  select p_purchase_id, p_household, coalesce(eq.pid, od.user_id),
         coalesce(eq.part, 0) + coalesce(od.amt, 0),
         case when coalesce(eq.pid, od.user_id) = p_payer then now() end
  from (
    select t.pid, v_base + case when t.pid <> p_payer and t.non_payer_rank <= v_rem then 1 else 0 end as part
    from (
      select u.pid, u.ord, count(*) filter (where u.pid <> p_payer) over (order by u.ord) as non_payer_rank
      from unnest(p_participant_ids) with ordinality as u(pid, ord)
    ) t
  ) eq
  full join (
    select o.user_id, sum(o.amount)::integer as amt from public.purchase_orders o where o.purchase_id = p_purchase_id group by o.user_id
  ) od on od.user_id = eq.pid;
end;
$$;

revoke all on function private.check_orders(uuid, uuid, integer, jsonb) from public, anon, authenticated;
revoke all on function private.insert_shares_with_orders(uuid, uuid, uuid, integer, uuid[], jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- create / resolve with orders

create function public.create_purchase_with_orders(
  p_household uuid,
  p_amount integer,
  p_description text,
  p_merchant text,
  p_participant_ids uuid[],
  p_orders jsonb
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

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status)
  values (p_household, v_uid, p_amount, v_desc, v_merchant, 'manual', 'shared')
  returning id into v_id;
  perform private.insert_shares_with_orders(v_id, p_household, v_uid, p_amount, p_participant_ids, coalesce(p_orders, '[]'::jsonb));
  return private.purchase_json(v_id);
end;
$$;

-- «Общее» with orders for a pending Apple Pay capture (payer only, only while pending; idempotent when already shared).
create function public.resolve_pending_with_orders(
  p_purchase uuid,
  p_description text,
  p_participant_ids uuid[],
  p_orders jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
  v_desc text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_p from public.purchases p where p.id = p_purchase for update;
  if not found or v_p.payer_id <> v_uid or not private.is_member(v_p.household_id) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if v_p.status <> 'pending' then
    if v_p.status = 'shared' then
      return private.purchase_json(v_p.id);
    end if;
    raise exception 'already_resolved' using errcode = '23514';
  end if;
  v_desc := coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_p.description);
  if char_length(v_desc) not between 1 and 200 then
    raise exception 'invalid description' using errcode = '23514';
  end if;

  update public.purchases p set description = v_desc, status = 'shared' where p.id = v_p.id;
  perform private.insert_shares_with_orders(v_p.id, v_p.household_id, v_uid, v_p.amount, p_participant_ids, coalesce(p_orders, '[]'::jsonb));
  return private.purchase_json(v_p.id);
end;
$$;

-- ---------------------------------------------------------------- Telegram message with order lines

create or replace function private.tg_purchase_message(p_purchase uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_p public.purchases;
  v_title text;
  v_debts text;
  v_orders text;
begin
  select * into v_p from public.purchases where id = p_purchase;
  if not found then
    return null;
  end if;
  v_title := coalesce(nullif(btrim(v_p.description), ''), nullif(btrim(v_p.merchant), ''), 'Покупка');
  select string_agg(private.tg_tag(s.debtor_id) || ' — ' || private.tg_money(s.amount), E'\n' order by s.debtor_id)
    into v_debts
  from public.shares s
  where s.purchase_id = v_p.id and s.debtor_id <> v_p.payer_id;
  select string_agg(
           '+ заказ: ' || private.tg_tag(o.user_id) || ' ' || private.tg_money(o.amount)
             || case when o.note is null then '' else ' (' || private.tg_esc(o.note) || ')' end,
           E'\n' order by o.seq)
    into v_orders
  from public.purchase_orders o
  where o.purchase_id = v_p.id;
  return (case when v_p.bill_id is not null then '🏠 ' else '🛒 ' end)
    || private.tg_esc(v_title) || ' — ' || private.tg_money(v_p.amount) || E'\n'
    || 'Платил: ' || private.tg_tag(v_p.payer_id)
    || case when v_debts is null then '' else E'\nДолжны:\n' || v_debts end
    || case when v_orders is null then '' else E'\n' || v_orders end;
end;
$$;

-- One short line for the «Исправлено» post: «🛒 Вода — 3 000 ₸, платил @a»
create function private.tg_purchase_line(p_purchase uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select private.tg_esc(coalesce(nullif(btrim(p.description), ''), nullif(btrim(p.merchant), ''), 'Покупка'))
         || ' — ' || private.tg_money(p.amount) || ', платил ' || private.tg_tag(p.payer_id)
         || coalesce((select ', заказов: ' || count(*)::text from public.purchase_orders o where o.purchase_id = p.id having count(*) > 0), '')
  from public.purchases p where p.id = p_purchase
$$;
revoke all on function private.tg_purchase_line(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- update_purchase

create function public.update_purchase(
  p_id uuid,
  p_amount integer,
  p_description text,
  p_payer uuid,
  p_participant_ids uuid[],
  p_orders jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
  v_desc text := btrim(coalesce(p_description, ''));
  v_old text;
  v_chat bigint;
  v_new boolean;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_p from public.purchases p where p.id = p_id for update;
  if not found or not private.is_member(v_p.household_id) or v_p.status <> 'shared' then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  if v_p.payer_id <> v_uid and not private.is_admin(v_p.household_id) then
    raise exception 'only the payer or an admin can edit' using errcode = '42501';
  end if;
  if v_p.bill_id is not null then
    raise exception 'not_editable' using errcode = '23514';
  end if;
  -- same rule as delete_purchase: the payer's own auto-settle does not count, anything else paid or covered does
  if exists (select 1 from public.shares s where s.purchase_id = p_id and s.settled_at is not null and s.debtor_id <> v_p.payer_id)
     or exists (select 1 from public.shares s where s.purchase_id = p_id and s.settlement_id is not null)
     or exists (
       select 1 from public.settlement_shares ss
       join public.settlements st on st.id = ss.settlement_id
       where ss.purchase_id = p_id and st.status <> 'cancelled'
     ) then
    raise exception 'has_payments' using errcode = '23514';
  end if;
  if p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'amount must be 1..10000000' using errcode = '23514';
  end if;
  if char_length(v_desc) not between 1 and 200 then
    raise exception 'invalid description' using errcode = '23514';
  end if;
  if p_payer is null or not exists (
    select 1 from public.members m where m.household_id = v_p.household_id and m.user_id = p_payer and m.active
  ) then
    raise exception 'the payer must be an active member' using errcode = '23503';
  end if;

  v_old := private.tg_purchase_line(p_id);
  delete from public.shares where purchase_id = p_id;
  delete from public.purchase_orders where purchase_id = p_id;
  update public.purchases p set amount = p_amount, description = v_desc, payer_id = p_payer where p.id = p_id;
  perform private.insert_shares_with_orders(p_id, v_p.household_id, p_payer, p_amount, p_participant_ids, coalesce(p_orders, '[]'::jsonb));

  begin
    select h.telegram_chat_id into v_chat from public.households h where h.id = v_p.household_id;
    if v_chat is not null then
      insert into private.telegram_sent (kind, ref) values ('purchase_edit', gen_random_uuid()) on conflict do nothing;
      get diagnostics v_new = row_count;
      if v_new then
        perform private.tg_send(v_chat, '✏️ Исправлено: ' || v_old || ' → ' || private.tg_purchase_line(p_id));
      end if;
    end if;
  exception when others then
    null; -- never break the user's transaction
  end;
  return private.purchase_json(p_id);
end;
$$;

-- ---------------------------------------------------------------- water_brought with a payer

drop function public.water_brought(uuid, uuid);

create function public.water_brought(p_duty uuid, p_partner uuid default null, p_payer uuid default null)
returns public.duty_events
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_d public.duties;
  v_payer uuid;
  v_bottles int;
  v_liters int;
  v_amount int;
  v_today date := private.almaty_today();
  v_people uuid[];
  v_purchase uuid;
  v_row public.duty_events;
begin
  v_d := private.duty_event_open(p_duty, 'water');
  v_payer := coalesce(p_payer, v_uid);
  if p_partner is not null and (
    p_partner = v_uid or not exists (
      select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = p_partner and m.active
    )
  ) then
    raise exception 'invalid partner' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = v_payer and m.active
  ) then
    raise exception 'invalid payer' using errcode = '23514';
  end if;
  v_bottles := case when p_partner is null then 2 else 4 end;
  v_liters := v_bottles * v_d.bottle_liters;
  v_amount := v_liters * v_d.price_per_liter;

  select array_agg(m.user_id order by m.joined_at, m.user_id) into v_people
  from public.members m
  where m.household_id = v_d.household_id and m.active and (m.away_until is null or m.away_until < v_today);
  if v_people is null then
    select array_agg(m.user_id order by m.joined_at, m.user_id) into v_people
    from public.members m where m.household_id = v_d.household_id and m.active;
  end if;
  perform private.check_participants(v_d.household_id, v_amount, v_people);

  insert into public.purchases (household_id, payer_id, amount, description, source, status)
  values (v_d.household_id, v_payer, v_amount, 'Вода ' || v_liters || ' л', 'manual', 'shared')
  returning id into v_purchase;
  perform private.insert_equal_shares(v_purchase, v_d.household_id, v_payer, v_amount, v_people);

  insert into public.duty_events (duty_id, kind, user_id, partner_id, liters, purchase_id)
  values (p_duty, 'done', v_uid, p_partner, v_liters, v_purchase) returning * into v_row;
  update public.duties d set bottles_full = least(v_bottles, d.bottles_total) where d.id = p_duty;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.create_purchase_with_orders(uuid, integer, text, text, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.resolve_pending_with_orders(uuid, text, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.update_purchase(uuid, integer, text, uuid, uuid[], jsonb) from public, anon, authenticated;
revoke all on function public.water_brought(uuid, uuid, uuid) from public, anon, authenticated;

grant execute on function public.create_purchase_with_orders(uuid, integer, text, text, uuid[], jsonb) to authenticated;
grant execute on function public.resolve_pending_with_orders(uuid, text, uuid[], jsonb) to authenticated;
grant execute on function public.update_purchase(uuid, integer, text, uuid, uuid[], jsonb) to authenticated;
grant execute on function public.water_brought(uuid, uuid, uuid) to authenticated;
