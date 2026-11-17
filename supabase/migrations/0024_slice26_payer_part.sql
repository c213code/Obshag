-- Slice 26: one receipt, part shared and part mine («Из них моё»).
-- 0001-0023 are LIVE and untouched; this file only replaces two functions with the same signatures.
--
-- A shared purchase may carry ONE order whose user_id is the payer: «моё», the payer's own part of the receipt. It comes off
-- the total before the equal split, exactly like any other order, and lands in the payer's own (settled) share, so nobody
-- owes it. Example: 3 000 total, моё 1 000, four people -> 2 000 / 4 = 500 each; the payer's share is 1 500 (settled).
--   private.check_orders (0016): a payer order is allowed (at most one); every other check is unchanged.
--   private.tg_purchase_message (0016): the payer's order is not a «+ заказ» line, it goes on the «Платил» line:
--     «Платил: @x (себе 1 000 ₸)».
-- private.insert_shares_with_orders (0016) already full-joins the orders on the person and settles the payer's row, so it
-- is not replaced. create_purchase_with_orders, resolve_pending_with_orders and update_purchase all validate through
-- check_orders (via insert_shares_with_orders); nothing else rejects a payer order. The anon surface is unchanged (13).

-- ---------------------------------------------------------------- check_orders: the payer may have one order («моё»)

create or replace function private.check_orders(p_household uuid, p_payer uuid, p_total integer, p_orders jsonb)
returns bigint
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_e jsonb;
  v_user uuid;
  v_sum bigint := 0;
  v_payer_orders integer := 0;
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
      v_payer_orders := v_payer_orders + 1;
      if v_payer_orders > 1 then
        raise exception 'the payer has at most one own part' using errcode = '23514';
      end if;
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

revoke all on function private.check_orders(uuid, uuid, integer, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------- Telegram: «Платил: @x (себе 1 000 ₸)»

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
  v_mine integer;
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
  where o.purchase_id = v_p.id and o.user_id <> v_p.payer_id;
  select sum(o.amount)::integer into v_mine
  from public.purchase_orders o
  where o.purchase_id = v_p.id and o.user_id = v_p.payer_id;
  return (case when v_p.bill_id is not null then '🏠 ' else '🛒 ' end)
    || private.tg_esc(v_title) || ' — ' || private.tg_money(v_p.amount) || E'\n'
    || 'Платил: ' || private.tg_tag(v_p.payer_id)
    || case when v_mine is null then '' else ' (себе ' || private.tg_money(v_mine) || ')' end
    || case when v_debts is null then '' else E'\nДолжны:\n' || v_debts end
    || case when v_orders is null then '' else E'\n' || v_orders end;
end;
$$;
