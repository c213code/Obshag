-- 0009_slice11_admin_delete: (A) an active admin can delete any SHARED purchase of the flat,
-- (B) a manual «Напомнить» also posts to the household's Telegram group.
-- Nothing here touches 0001-0008. The anon surface stays at 4 functions.

-- ---------------------------------------------------------------- A. delete_purchase

create or replace function public.delete_purchase(p_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
  v_admin boolean;
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

revoke all on function public.delete_purchase(uuid) from public, anon, authenticated;
grant execute on function public.delete_purchase(uuid) to authenticated;

-- ---------------------------------------------------------------- B. manual reminder -> Telegram

-- 🔔 @debtor, напоминание: ты должен @creditor 1 200 ₸
create or replace function private.tg_remind_message(p_debtor uuid, p_creditor uuid, p_amount bigint)
returns text
language sql
stable
set search_path = ''
as $$
  select '🔔 ' || private.tg_tag(p_debtor) || ', напоминание: ты должен ' || private.tg_tag(p_creditor)
         || ' ' || private.tg_money(p_amount)
$$;
revoke all on function private.tg_remind_message(uuid, uuid, bigint) from public, anon, authenticated;

-- Same as 0005 plus the group post. Only this function (the manual path) posts; run_daily_reminders never does.
-- A cooldown-blocked call raises before the insert, so it posts nothing.
create or replace function public.remind(p_secret text, p_household uuid, p_debtor uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_net bigint;
  v_last timestamptz;
  v_chat bigint;
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

  begin
    select h.telegram_chat_id into v_chat from public.households h where h.id = p_household;
    if v_chat is not null then
      perform private.tg_send(v_chat, private.tg_remind_message(p_debtor, v_uid, v_net));
    end if;
  exception when others then
    null; -- Telegram must never break the reminder
  end;

  return jsonb_build_object(
    'to_user', p_debtor,
    'from_user', v_uid,
    'from_name_dative', (select pr.display_name from public.profiles pr where pr.id = v_uid),
    'amount', v_net,
    'subscriptions', private.subscriptions_of(p_debtor)
  );
end;
$$;

revoke all on function public.remind(text, uuid, uuid) from public, anon, authenticated;
grant execute on function public.remind(text, uuid, uuid) to authenticated;
