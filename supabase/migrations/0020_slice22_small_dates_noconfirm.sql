-- Slice 22: no pay button under 100 ₸, dates in the reminder, and no creditor confirmation. 0001-0019 are live and untouched.
-- Replaced functions are copies of their latest live version with only the changes marked "slice22".
--   1. private.tg_on_purchase (0019): a debtor whose pair net is < min_transfer gets no button; a footer explains it.
--   2. private.tg_pair_lines + public.remind (0017): the reminder lists what the debt is made of, with dates.
--   3. The debtor's «Да, перевёл» is final. Choke point: private.finalize_settlement(id) holds the confirm logic (shares
--      settled, status 'confirmed', the tg_on_settlement «рассчитались» post fires). public.confirm_settlement delegates to it
--      (old clients), and BOTH marking routines (public.mark_settlement, private.mark_settlement_for) call it right after
--      recording the shares. Every other path (answer_paid_prompt, tg_answer_paid, pay_link_answer) marks through
--      private.paid_prompt_answer -> mark_settlement_for, so nothing new stays 'marked'. Write-offs are unchanged.
--   4. Existing 'marked' transfers are finalized at the end of this file.

-- ---------------------------------------------------------------- 3. the shared settle logic

create function private.finalize_settlement(p_settlement_id uuid, p_expected_amount integer default null)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.settlements;
  v_n integer;
begin
  -- the caller holds the pair lock (lock order: pair advisory lock -> row locks)
  select * into v_row from public.settlements st where st.id = p_settlement_id for update;
  if not found then
    raise exception 'settlement not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'confirmed' then
    return v_row; -- finalizing twice is a no-op
  end if;
  if v_row.status <> 'marked' then
    raise exception 'settlement is not open' using errcode = '23514';
  end if;

  -- the creditor confirms the amount they SAW; if the record was refreshed since, refuse
  if p_expected_amount is not null and p_expected_amount <> v_row.amount then
    raise exception 'stale_settlement' using errcode = '23514';
  end if;

  -- lock the covered share rows before judging them
  perform 1
  from public.shares s
  join public.settlement_shares ss on ss.purchase_id = s.purchase_id and ss.debtor_id = s.debtor_id
  where ss.settlement_id = v_row.id
  for update of s;

  if not exists (select 1 from public.settlement_shares ss where ss.settlement_id = v_row.id)
     or exists (
       select 1
       from public.settlement_shares ss
       left join public.shares s on s.purchase_id = ss.purchase_id and s.debtor_id = ss.debtor_id
       left join public.purchases p on p.id = s.purchase_id
       where ss.settlement_id = v_row.id
         and (s.purchase_id is null or s.settled_at is not null or s.amount <> ss.amount or p.status <> 'shared')
     ) then
    raise exception 'stale_settlement' using errcode = '23514';
  end if;

  update public.shares s
  set settled_at = now(), settlement_id = v_row.id
  from public.settlement_shares ss
  where ss.settlement_id = v_row.id
    and s.purchase_id = ss.purchase_id
    and s.debtor_id = ss.debtor_id;
  get diagnostics v_n = row_count;
  if v_n <> (select count(*) from public.settlement_shares ss where ss.settlement_id = v_row.id) then
    raise exception 'stale_settlement' using errcode = '23514';
  end if;

  update public.settlements st
  set status = 'confirmed', confirmed_at = now()
  where st.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;
revoke all on function private.finalize_settlement(uuid, integer) from public, anon, authenticated;

-- 0003 confirm_settlement: same checks, the settle logic now lives in private.finalize_settlement
create or replace function public.confirm_settlement(p_settlement_id uuid, p_expected_amount integer default null)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.settlements;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.settlements st where st.id = p_settlement_id;
  if not found or v_uid not in (v_row.from_id, v_row.to_id) or not private.is_member(v_row.household_id) then
    raise exception 'settlement not found' using errcode = 'P0002';
  end if;
  if v_row.to_id <> v_uid then
    raise exception 'only the creditor can confirm' using errcode = '42501';
  end if;

  perform private.lock_pair(v_row.household_id, v_row.from_id, v_row.to_id);
  return private.finalize_settlement(p_settlement_id, p_expected_amount);
end;
$$;
revoke all on function public.confirm_settlement(uuid, integer) from public, anon, authenticated;
grant execute on function public.confirm_settlement(uuid, integer) to authenticated;

-- 0015 mark_settlement_for; slice22: finalized right after the shares are recorded
create or replace function private.mark_settlement_for(p_uid uuid, p_household_id uuid, p_to uuid)
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
    return private.finalize_settlement((private.record_settlement_shares(v_row.id)).id); -- slice22
  end if;

  if v_net <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;

  insert into public.settlements (household_id, from_id, to_id, amount, status)
  values (p_household_id, p_uid, p_to, 1, 'marked')
  returning * into v_row;
  return private.finalize_settlement((private.record_settlement_shares(v_row.id)).id); -- slice22: the mark is final
end;
$$;

revoke all on function private.mark_settlement_for(uuid, uuid, uuid) from public, anon, authenticated;

-- 0011 mark_settlement; slice22: finalized right after the shares are recorded
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
    return private.finalize_settlement((private.record_settlement_shares(v_row.id)).id); -- slice22
  end if;

  if v_net <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;

  insert into public.settlements (household_id, from_id, to_id, amount, status)
  values (p_household_id, v_uid, p_to, 1, 'marked') -- the amount is replaced right below, from the recorded rows
  returning * into v_row;
  return private.finalize_settlement((private.record_settlement_shares(v_row.id)).id); -- slice22: the mark is final
end;
$$;
revoke all on function public.mark_settlement(uuid, uuid) from public, anon, authenticated;
grant execute on function public.mark_settlement(uuid, uuid) to authenticated;

-- 0017 paid_prompt_answer; slice22: a pair settled meanwhile by the same debtor is answered «marked»
create or replace function private.paid_prompt_answer(p_actor uuid, p_prompt uuid, p_yes boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_p public.paid_prompts;
  v_net bigint;
  v_to_name text;
  v_marked boolean;
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
  v_marked := exists (
    select 1 from public.settlements st
    where st.household_id = v_p.household_id and st.from_id = v_p.from_user and st.to_id = v_p.to_user and st.status = 'marked'
  );

  if v_marked then
    -- the PWA (or the other button) marked it first: no second mark; debts that came after are added to that record
    if v_net >= private.min_transfer() then
      perform private.mark_settlement_for(v_p.from_user, v_p.household_id, v_p.to_user);
    end if;
    update public.paid_prompts p set status = 'yes' where p.id = v_p.id;
    return jsonb_build_object('result', 'marked', 'to_name', v_to_name);
  end if;

  -- slice22: the mark is final now, so a pair settled meanwhile (the app or the other button) by this debtor after the
  -- prompt was opened is answered «marked» too
  if v_net <= 0 and exists (
    select 1 from public.settlements st
    where st.household_id = v_p.household_id and st.from_id = v_p.from_user and st.to_id = v_p.to_user
      and st.kind = 'transfer' and st.status = 'confirmed' and st.marked_at >= v_p.opened_at
  ) then
    update public.paid_prompts p set status = 'yes' where p.id = v_p.id;
    return jsonb_build_object('result', 'marked', 'to_name', v_to_name);
  end if;

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

  perform private.mark_settlement_for(v_p.from_user, v_p.household_id, v_p.to_user);
  update public.paid_prompts p set status = 'yes' where p.id = v_p.id;
  return jsonb_build_object('result', 'marked', 'to_name', v_to_name);
end;
$$;
revoke all on function private.paid_prompt_answer(uuid, uuid, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------- 1. purchase post

-- 0019 tg_on_purchase
create or replace function private.tg_on_purchase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_chat bigint;
  v_new boolean;
  v_text text;
  v_rows jsonb;
  v_d record;
  v_code text;
  v_small boolean;
begin
  begin
    if new.status = 'shared' and (tg_op = 'INSERT' or old.status = 'pending') then
      select h.telegram_chat_id into v_chat from public.households h where h.id = new.household_id;
      if v_chat is not null then
        insert into private.telegram_sent (kind, ref) values ('purchase', new.id) on conflict do nothing;
        get diagnostics v_new = row_count;
        if v_new then
          v_text := private.tg_purchase_message(new.id);
          -- slice22: a debtor whose total to the payer is under the Kaspi minimum gets no button, only a note
          select exists (
            select 1
            from public.shares s
            join public.members m on m.household_id = new.household_id and m.user_id = s.debtor_id and m.active
            where s.purchase_id = new.id and s.debtor_id <> new.payer_id and s.amount > 0 and s.settled_at is null
              and private.pair_net(new.household_id, s.debtor_id, new.payer_id) < private.min_transfer()
          ) into v_small;
          if v_small then
            v_text := v_text || E'\n\nМеньше 100 ₸ переводить не нужно — добавится к следующему разу.';
          end if;
          begin
            -- one row per debtor, same order as the «Должны» lines; the sub-block rolls the links back on any error
            v_rows := '[]'::jsonb;
            for v_d in
              select s.debtor_id, left(pr.display_name, 30) as name
              from public.shares s
              join public.profiles pr on pr.id = s.debtor_id
              join public.members m on m.household_id = new.household_id and m.user_id = s.debtor_id and m.active
              where s.purchase_id = new.id and s.debtor_id <> new.payer_id and s.amount > 0 and s.settled_at is null
                and private.pair_net(new.household_id, s.debtor_id, new.payer_id) >= private.min_transfer() -- slice22
              order by s.debtor_id
            loop
              v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_');
              insert into public.pay_links (code, household_id, from_user, to_user)
                values (v_code, new.household_id, v_d.debtor_id, new.payer_id);
              v_rows := v_rows || jsonb_build_array(jsonb_build_array(jsonb_build_object(
                'text', '💸 ' || v_d.name || ' → перевести',
                'url', private.app_url() || '/k/' || v_code
              )));
            end loop;
            if jsonb_array_length(v_rows) = 0 then
              perform private.tg_send(v_chat, v_text);
            else
              perform private.tg_send_markup(v_chat, v_text, jsonb_build_object('inline_keyboard', v_rows));
            end if;
          exception when others then
            perform private.tg_send(v_chat, v_text); -- no links: the plain post
          end;
        end if;
      end if;
    end if;
  exception when others then
    null; -- never break the user's transaction
  end;
  return null;
end;
$$;
revoke all on function private.tg_on_purchase() from public, anon, authenticated;


-- ---------------------------------------------------------------- 2. reminder lines

-- «• 10 нояб · Ip Mahanova. G — 75 ₸»; shares of the other direction: «• 9 нояб · нан — −150 ₸ (его долг тебе)»
create function private.tg_pair_lines(p_household uuid, p_debtor uuid, p_creditor uuid)
returns text
language sql stable security definer
set search_path = ''
as $$
  with rows as (
    select row_number() over (order by p.created_at, p.id, o.debtor_id) as rn,
           o.debtor_id, o.amount,
           coalesce(nullif(btrim(p.description), ''), nullif(btrim(p.merchant), ''), 'Покупка') as title,
           p.created_at at time zone 'Asia/Almaty' as at_local
    from private.open_pair_shares(p_household, p_debtor, p_creditor) o
    join public.purchases p on p.id = o.purchase_id
  ), shown as (
    select rn, '• ' || extract(day from at_local)::int::text || ' '
           || (array['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','нояб','дек'])[extract(month from at_local)::int]
           || ' · ' || private.tg_esc(title) || ' — '
           || case when debtor_id = p_debtor then private.tg_money(amount)
                   else '−' || private.tg_money(amount) || ' (его долг тебе)' end as line
    from rows where rn <= 8
  )
  select nullif(
    coalesce((select string_agg(line, E'\n' order by rn) from shown), '')
    || case when (select count(*) from rows) > 8 then E'\n• и ещё ' || ((select count(*) from rows) - 8)::text else '' end,
    '')
$$;
revoke all on function private.tg_pair_lines(uuid, uuid, uuid) from public, anon, authenticated;

-- 0017 remind; slice22: the debt lines after the reminder text
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
  v_text text;
  v_back bigint;
  v_code text;
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
  if v_net < private.min_transfer() then
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
      v_text := private.tg_remind_message(p_debtor, v_uid, v_net)
        || coalesce(E'\n' || private.tg_pair_lines(p_household, p_debtor, v_uid), ''); -- slice22: what the debt is made of
      -- slice19: the creditor already sent money the debtor has not confirmed
      select coalesce(sum(st.amount), 0) into v_back
      from public.settlements st
      where st.household_id = p_household and st.from_id = v_uid and st.to_id = p_debtor and st.status = 'marked';
      if v_back > 0 then
        v_text := v_text || E'\nИ подтверди, что ' || private.tg_tag(v_uid) || ' перевёл тебе ' || private.tg_money(v_back);
      end if;
      begin
        delete from public.pay_links l where l.expires_at < now() - interval '30 days';
        v_code := translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/', '-_');
        insert into public.pay_links (code, household_id, from_user, to_user) values (v_code, p_household, p_debtor, v_uid);
        perform private.tg_send_markup(
          v_chat, v_text,
          jsonb_build_object('inline_keyboard', jsonb_build_array(jsonb_build_array(jsonb_build_object(
            'text', '💸 Перевести ' || private.tg_money(v_net),
            'url', private.app_url() || '/k/' || v_code
          ))))
        );
      exception when others then
        perform private.tg_send(v_chat, v_text); -- no link: the plain reminder
      end;
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

-- ---------------------------------------------------------------- 4. data: pending transfers are final too
do $$
declare
  r record;
begin
  for r in select st.id from public.settlements st where st.status = 'marked' and st.kind = 'transfer' order by st.marked_at loop
    begin
      perform private.finalize_settlement(r.id);
    exception when others then
      raise notice 'settlement % stays marked: %', r.id, sqlerrm;
    end;
  end loop;
end;
$$;
