-- Slice 25. 0023 (never edit 0001-0022).
--   A. public.delete_purchase (0022): no automatic «↩︎ Возврат» — a deleted purchase simply disappears (settled shares go
--      away with it, confirmed settlements stay as history). The slice-24 refund purchases are cleaned up at the end.
--   B. public.mark_received(household, from): the creditor records that the debtor sent the money.
--   C. public.paid_prompt_notice (0017): the «Ты перевёл?» DM may be asked once the prompt is 15 s old (was 120 s).
--   Anon surface unchanged (13).

-- ---------------------------------------------------------------- A. delete just removes

create or replace function public.delete_purchase(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
  v_admin boolean;
  v_title text;
  v_chat bigint;
  v_s record;
  v_st uuid;
  v_total bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_p from public.purchases p where p.id = p_id for update;
  if not found or not private.is_member(v_p.household_id) or (v_p.status <> 'shared' and v_p.payer_id <> v_uid) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;
  -- an admin may delete only shared purchases (pending and personal ones stay private to the payer)
  v_admin := v_p.status = 'shared' and private.is_admin(v_p.household_id);
  if v_p.payer_id <> v_uid and not v_admin then
    raise exception 'only the payer or an admin can delete' using errcode = '42501';
  end if;

  v_title := coalesce(nullif(btrim(v_p.description), ''), nullif(btrim(v_p.merchant), ''), 'Покупка');

  if v_p.status = 'shared' then
    -- lock every pair first (same order for everybody)
    for v_s in
      select distinct s.debtor_id from public.shares s where s.purchase_id = p_id and s.debtor_id <> v_p.payer_id order by 1
    loop
      perform private.lock_pair(v_p.household_id, v_p.payer_id, v_s.debtor_id);
    end loop;

    -- settlements that recorded this purchase stay as history; their recorded rows for it go away (settlement_shares has
    -- no foreign key to purchases). A still-marked settlement is re-totalled, or cancelled when nothing is left.
    for v_st in
      select distinct ss.settlement_id from public.settlement_shares ss where ss.purchase_id = p_id
    loop
      delete from public.settlement_shares ss where ss.settlement_id = v_st and ss.purchase_id = p_id;
      select coalesce(sum(case when ss.debtor_id = st.from_id then ss.amount else -ss.amount end), 0) into v_total
      from public.settlement_shares ss join public.settlements st on st.id = ss.settlement_id
      where ss.settlement_id = v_st;
      update public.settlements st
         set status = case when v_total <= 0 then 'cancelled' else st.status end,
             amount = case when v_total > 0 then v_total::int else st.amount end
       where st.id = v_st and st.status = 'marked';
    end loop;
  end if;

  delete from public.purchases where id = p_id;

  if v_p.status = 'shared' then
    begin
      select h.telegram_chat_id into v_chat from public.households h where h.id = v_p.household_id;
      if v_chat is not null then
        perform private.tg_send(v_chat,
          '🗑 ' || private.tg_tag(v_uid) || ' удалил «' || private.tg_esc(v_title) || '» — ' || private.tg_money(v_p.amount));
      end if;
    exception when others then
      null; -- Telegram must never break the delete
    end;
  end if;
end;
$$;

-- ---------------------------------------------------------------- B. the creditor marks «X перевёл мне»

create function public.mark_received(p_household uuid, p_from uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_net bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or p_from is null or not private.is_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_from = v_uid then
    raise exception 'cannot settle with yourself' using errcode = '23514';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_from and m.active) then
    raise exception 'counterparty is not an active member' using errcode = '23503';
  end if;
  v_net := private.pair_net(p_household, p_from, v_uid);
  if v_net <= 0 then
    raise exception 'nothing_owed' using errcode = '23514';
  end if;
  if v_net < private.min_transfer() then
    raise exception 'too_small' using errcode = 'P0001';
  end if;
  -- creates the settlement on the debtor's behalf and finalizes it (locks the pair, rate limit, shares, post)
  return private.mark_settlement_for(p_from, p_household, v_uid);
end;
$$;
revoke all on function public.mark_received(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_received(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- C. the DM after 20 s

create or replace function public.paid_prompt_notice(p_secret text, p_prompt uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.paid_prompts;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select * into v_p from public.paid_prompts p where p.id = p_prompt for update;
  if not found or (v_uid is not null and v_p.from_user <> v_uid) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_uid := v_p.from_user;
  perform private.paid_prompt_expire();
  select * into v_p from public.paid_prompts p where p.id = p_prompt;
  -- a newer open of the same pair refreshed opened_at: its own delayed job asks later
  if v_p.status <> 'pending' or v_p.asked_at is not null or v_p.opened_at > now() - interval '15 seconds' then
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
revoke all on function public.paid_prompt_notice(text, uuid) from public, anon, authenticated;
grant execute on function public.paid_prompt_notice(text, uuid) to authenticated, anon;

-- ---------------------------------------------------------------- D. data: drop the slice-24 automatic refund purchases

do $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.purchases p
  where p.source = 'manual' and p.description like '↩︎ Возврат: %'
    and (select count(*) from public.shares s where s.purchase_id = p.id) = 2
    and exists (select 1 from public.shares s where s.purchase_id = p.id and s.debtor_id = p.payer_id and s.amount = 0 and s.settled_at is not null)
    and exists (select 1 from public.shares s where s.purchase_id = p.id and s.debtor_id <> p.payer_id and s.settled_at is null)
    and not exists (select 1 from public.shares s where s.purchase_id = p.id and s.settled_at is not null and s.amount > 0)
    and not exists (select 1 from public.settlement_shares ss where ss.purchase_id = p.id);
  delete from private.telegram_sent t where t.kind = 'purchase' and t.ref = any (v_ids);
  delete from public.purchases p where p.id = any (v_ids);
end;
$$;
