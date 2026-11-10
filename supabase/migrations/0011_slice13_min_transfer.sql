-- Slice 13: Kaspi cannot transfer less than 100 tenge. A pair net of 1..99 is "accumulating": no reminder, no «paid» mark,
-- and the creditor may write it off. 0001-0010 are live and untouched; replaced functions are copies of their latest
-- live version (run_daily_reminders 0005, remind 0009, mark_settlement 0003, tg_on_settlement 0007) with only the
-- changes marked "slice13".

-- ---------------------------------------------------------------- the rule (mirrors src/lib/domain/minTransfer.ts)
create function private.min_transfer()
returns integer
language sql
immutable
set search_path = ''
as $$ select 100 $$;
revoke all on function private.min_transfer() from public, anon, authenticated;

-- ---------------------------------------------------------------- settlements.kind
alter table public.settlements
  add column kind text not null default 'transfer' check (kind in ('transfer', 'writeoff'));

-- ---------------------------------------------------------------- run_daily_reminders (0005; slice13: skip nets below the minimum)
create or replace function public.run_daily_reminders(p_secret text)
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
    continue when v_net < private.min_transfer(); -- slice13 (was: <= 0)

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
revoke all on function public.run_daily_reminders(text) from public, anon, authenticated;
grant execute on function public.run_daily_reminders(text) to anon;

-- ---------------------------------------------------------------- remind (0009; slice13: too_small before the cooldown, log and post)
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
  if v_net < private.min_transfer() then -- slice13
    raise exception 'too_small' using errcode = 'P0001';
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

-- ---------------------------------------------------------------- mark_settlement (0003; slice13: too_small)
create or replace function public.mark_settlement(p_household_id uuid, p_to uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.settlements;
  v_net bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household_id is null or p_to is null or not private.is_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_to = v_uid then
    raise exception 'cannot settle with yourself' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.members m where m.household_id = p_household_id and m.user_id = p_to and m.active
  ) then
    raise exception 'counterparty is not an active member' using errcode = '23503';
  end if;

  perform private.lock_pair(p_household_id, v_uid, p_to);
  perform private.check_settlement_rate(v_uid);

  -- slice13: a debt Kaspi cannot transfer is never marked as paid (the creditor can write it off instead)
  v_net := private.pair_net(p_household_id, v_uid, p_to);
  if v_net > 0 and v_net < private.min_transfer() then
    raise exception 'too_small' using errcode = 'P0001';
  end if;

  select * into v_row from public.settlements st
  where st.household_id = p_household_id and st.from_id = v_uid and st.to_id = p_to and st.status = 'marked'
  order by st.marked_at desc, st.id
  limit 1
  for update;
  if found then
    -- idempotent: one open marked settlement per pair and direction, but its record follows the current open shares
    return private.record_settlement_shares(v_row.id);
  end if;

  if v_net <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;

  insert into public.settlements (household_id, from_id, to_id, amount, status)
  values (p_household_id, v_uid, p_to, 1, 'marked') -- the amount is replaced right below, from the recorded rows
  returning * into v_row;
  return private.record_settlement_shares(v_row.id);
end;
$$;
revoke all on function public.mark_settlement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_settlement(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- write_off_small
-- The creditor closes a debt of 1..99 without a transfer. Same books as the confirm path: a settlement is recorded from
-- the current open shares, then public.confirm_settlement (same caller, same pair lock) closes exactly those shares.
create function public.write_off_small(p_household uuid, p_debtor uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_net bigint;
  v_row public.settlements;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or p_debtor is null or p_debtor = v_uid or not private.is_member(p_household) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_debtor and m.active) then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  perform private.lock_pair(p_household, v_uid, p_debtor);
  perform private.check_settlement_rate(v_uid);

  v_net := private.pair_net(p_household, p_debtor, v_uid);
  if v_net <= 0 then
    raise exception 'not a creditor' using errcode = '42501';
  end if;
  if v_net >= private.min_transfer() then
    raise exception 'not_small' using errcode = 'P0001';
  end if;

  -- a stale «paid» mark of the same pair would be superseded: withdraw it, the write-off covers the same shares
  update public.settlements st set status = 'cancelled'
  where st.household_id = p_household and st.from_id = p_debtor and st.to_id = v_uid and st.status = 'marked';

  insert into public.settlements (household_id, from_id, to_id, amount, status, kind)
  values (p_household, p_debtor, v_uid, 1, 'marked', 'writeoff')
  returning * into v_row;
  v_row := private.record_settlement_shares(v_row.id);
  return public.confirm_settlement(v_row.id, v_row.amount::integer);
end;
$$;
revoke all on function public.write_off_small(uuid, uuid) from public, anon, authenticated;
grant execute on function public.write_off_small(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------- Telegram
-- 🧾 @creditor списал(а) @debtor 75 ₸ (меньше 100 — Kaspi не переводит)
create function private.tg_writeoff_message(p_settlement uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select '🧾 ' || private.tg_tag(st.to_id) || ' списал(а) ' || private.tg_tag(st.from_id)
         || ' ' || private.tg_money(st.amount) || ' (меньше ' || private.min_transfer() || ' — Kaspi не переводит)'
  from public.settlements st where st.id = p_settlement
$$;
revoke all on function private.tg_writeoff_message(uuid) from public, anon, authenticated;

-- 0007 tg_on_settlement; slice13: a write-off posts its own message instead of «рассчитались»
create or replace function private.tg_on_settlement()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat bigint;
  v_new boolean;
begin
  begin
    if new.status = 'confirmed' and old.status is distinct from 'confirmed' then
      select h.telegram_chat_id into v_chat from public.households h where h.id = new.household_id;
      if v_chat is not null then
        insert into private.telegram_sent (kind, ref) values ('settlement', new.id) on conflict do nothing;
        get diagnostics v_new = row_count;
        if v_new then
          perform private.tg_send(v_chat, case when new.kind = 'writeoff'
            then private.tg_writeoff_message(new.id) else private.tg_settlement_message(new.id) end);
        end if;
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;
revoke all on function private.tg_on_settlement() from public, anon, authenticated;
