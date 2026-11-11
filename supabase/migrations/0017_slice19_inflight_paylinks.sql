-- Slice 19: «Перевод в пути» + «💸 Перевести» in the Telegram reminder. 0001-0016 are live and untouched; replaced functions
-- are copies of their latest live version with only the changes marked "slice19".
--
--   A. A share recorded in settlement_shares of a settlement with status 'marked' is IN FLIGHT: it is not an open debt for
--      any netting / balance / reminder (private.open_pair_shares skips it). Rows are not changed (settled_at stays null
--      until the creditor confirms). Cancel / reject puts the share back among the open ones, confirm closes it as before.
--      private.record_settlement_shares deletes its own rows BEFORE it reads open_pair_shares, so a re-mark of a pending
--      settlement still records its own shares again.
--      Sites that sum open shares and what was decided for each:
--        private.pair_net / run_daily_reminders / remind / mark_settlement[_for] / paid_prompt_answer / open_paid_prompt:
--          go through open_pair_shares -> the new rule (paid_prompt_answer is replaced: an already marked pair is answered
--          «marked» before the net is looked at, because the mark itself now makes the net 0).
--        private.has_open_net (0006, «settle up before you leave»): replaced, a pending transfer to / from that person
--          still blocks leaving (in flight is not settled yet).
--        public.write_off_small (0011): replaced, it no longer cancels the debtor's pending mark (that would write off
--          money the debtor already sent); the write-off covers exactly the open shares.
--        delete / edit purchase guards (0009, 0016): already refuse when any non-cancelled settlement_shares row exists.
--        purchase_json / purchase_progress: show settled_at only, unchanged.
--   B. public.pay_links + a short /k/<code> page. The Telegram reminder carries a «💸 Перевести <сумма>» inline button.
--      private.app_url()              the public URL of the app.
--      private.tg_send_markup(...)    tg_send (0007) with a reply_markup.
--      public.remind                  also posts «И подтверди, что @C перевёл тебе N ₸» (C paid D, D did not confirm) and the button.
--      public.pay_link_open(secret, code, open)    ANON + server secret. expired | paid | small | pay; open = true records the
--                                                  «opened Kaspi» prompt (same body as open_paid_prompt) and returns prompt_id.
--      public.pay_link_answer(secret, code, prompt, yes)   ANON + server secret; the prompt must belong to the link's pair.
--      public.paid_prompt_notice(secret, prompt)   now ANON-callable too (secret-gated; without a session the prompt's owner is used).
--      Anon surface: was 10 functions (0015), now 13 (+ pay_link_open, pay_link_answer, paid_prompt_notice).
-- All functions are security definer with search_path = ''.

-- ---------------------------------------------------------------- A. in flight

create or replace function private.open_pair_shares(p_household_id uuid, p_a uuid, p_b uuid)
returns table (purchase_id uuid, debtor_id uuid, amount integer)
language sql stable security definer
set search_path = ''
as $$
  select s.purchase_id, s.debtor_id, s.amount
  from public.shares s
  join public.purchases p on p.id = s.purchase_id and p.household_id = s.household_id
  where s.household_id = p_household_id
    and s.settled_at is null
    and p.status = 'shared'
    and s.debtor_id <> p.payer_id
    and ((s.debtor_id = p_a and p.payer_id = p_b) or (s.debtor_id = p_b and p.payer_id = p_a))
    -- slice19: a share inside a marked (unconfirmed) transfer counts as paid
    and not exists (
      select 1
      from public.settlement_shares ss
      join public.settlements st on st.id = ss.settlement_id
      where st.status = 'marked' and ss.purchase_id = s.purchase_id and ss.debtor_id = s.debtor_id
    )
$$;
revoke all on function private.open_pair_shares(uuid, uuid, uuid) from public, anon, authenticated;

-- 0006: «settle up first» also while a transfer with that person is pending
create or replace function private.has_open_net(p_household uuid, p_user uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = p_household and m.user_id <> p_user
      and (
        private.pair_net(p_household, p_user, m.user_id) <> 0
        or exists (
          select 1 from public.settlements st
          where st.household_id = p_household and st.status = 'marked'
            and ((st.from_id = p_user and st.to_id = m.user_id) or (st.from_id = m.user_id and st.to_id = p_user))
        )
      )
  );
$$;
revoke all on function private.has_open_net(uuid, uuid) from public, anon, authenticated;

-- 0011 write_off_small; slice19: the debtor's pending mark is left alone (its shares are already out of the net)
create or replace function public.write_off_small(p_household uuid, p_debtor uuid)
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

  insert into public.settlements (household_id, from_id, to_id, amount, status, kind)
  values (p_household, p_debtor, v_uid, 1, 'marked', 'writeoff')
  returning * into v_row;
  v_row := private.record_settlement_shares(v_row.id);
  return public.confirm_settlement(v_row.id, v_row.amount::integer);
end;
$$;
revoke all on function public.write_off_small(uuid, uuid) from public, anon, authenticated;
grant execute on function public.write_off_small(uuid, uuid) to authenticated;

-- 0015 paid_prompt_answer; slice19: an already marked pair is answered «marked» first (the mark makes the net 0 now)
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

-- ---------------------------------------------------------------- the «opened Kaspi» prompt, one body for the app and the link

-- 0015 open_paid_prompt without the session: the caller has authenticated p_uid (a signed-in debtor or a pay link).
create function private.open_paid_prompt_for(p_uid uuid, p_household uuid, p_to uuid)
returns public.paid_prompts
language plpgsql security definer
set search_path = ''
as $$
declare
  v_net bigint;
  v_row public.paid_prompts;
begin
  if p_uid is null or p_household is null or p_to is null
     or not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_uid and m.active) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_to = p_uid then
    raise exception 'cannot settle with yourself' using errcode = '23514';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_to and m.active) then
    raise exception 'counterparty is not an active member' using errcode = '23503';
  end if;

  perform private.lock_pair(p_household, p_uid, p_to);
  v_net := private.pair_net(p_household, p_uid, p_to);
  if v_net <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;
  if v_net < private.min_transfer() then
    raise exception 'too_small' using errcode = 'P0001';
  end if;

  perform private.paid_prompt_expire();
  update public.paid_prompts p
  set opened_at = now(), amount = v_net, asked_at = null
  where p.household_id = p_household and p.from_user = p_uid and p.to_user = p_to and p.status = 'pending'
  returning * into v_row;
  if not found then
    insert into public.paid_prompts (household_id, from_user, to_user, amount)
    values (p_household, p_uid, p_to, v_net)
    returning * into v_row;
  end if;
  -- old answered rows are not needed for anything
  delete from public.paid_prompts p where p.from_user = p_uid and p.status <> 'pending' and p.opened_at < now() - interval '7 days';
  return v_row;
end;
$$;
revoke all on function private.open_paid_prompt_for(uuid, uuid, uuid) from public, anon, authenticated;

create or replace function public.open_paid_prompt(p_household uuid, p_to uuid)
returns public.paid_prompts
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or p_to is null or not private.is_member(p_household) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  return private.open_paid_prompt_for(v_uid, p_household, p_to);
end;
$$;
revoke all on function public.open_paid_prompt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.open_paid_prompt(uuid, uuid) to authenticated;

-- 0015 paid_prompt_notice; slice19: also callable by the anon server client (the pay link has no session). With a session
-- the caller must still be the prompt's owner; without one the secret is the only credential and the owner is the prompt's.
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
revoke all on function public.paid_prompt_notice(text, uuid) from public, anon, authenticated;
grant execute on function public.paid_prompt_notice(text, uuid) to authenticated, anon;

-- ---------------------------------------------------------------- B. pay links

create function private.app_url()
returns text
language sql
immutable
set search_path = ''
as $$ select 'https://obshak-gules.vercel.app'::text $$;
revoke all on function private.app_url() from public, anon, authenticated;

-- server only: no policies, no grants. The code is the bearer token shared in the roommates' group.
create table public.pay_links (
  code         text primary key check (char_length(code) >= 10),
  household_id uuid not null,
  from_user    uuid not null, -- the debtor
  to_user      uuid not null, -- the creditor
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '7 days',
  opened_at    timestamptz,
  check (from_user <> to_user),
  foreign key (household_id) references public.households(id) on delete cascade,
  foreign key (household_id, from_user) references public.members(household_id, user_id),
  foreign key (household_id, to_user) references public.members(household_id, user_id)
);
create index pay_links_expires_idx on public.pay_links (expires_at);
alter table public.pay_links enable row level security;
revoke all on public.pay_links from public, anon, authenticated;

-- 0007 tg_send with a reply_markup (an inline keyboard)
create function private.tg_send_markup(p_chat bigint, p_text text, p_markup jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text;
begin
  if p_chat is null or p_text is null then
    return;
  end if;
  if to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null
     or to_regclass('vault.decrypted_secrets') is null then
    return;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1 limit 1'
    into v_token using 'telegram_bot_token';
  if v_token is null or v_token = '' then
    return;
  end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using 'https://api.telegram.org/bot' || v_token || '/sendMessage',
          jsonb_build_object('chat_id', p_chat, 'text', p_text, 'parse_mode', 'HTML', 'disable_web_page_preview', true,
                             'reply_markup', p_markup),
          '{"Content-Type": "application/json"}'::jsonb;
end;
$$;
revoke all on function private.tg_send_markup(bigint, text, jsonb) from public, anon, authenticated;

-- 0011 remind; slice19: the «И подтверди …» line and the «💸 Перевести» button (a pay link for debtor -> creditor)
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
      v_text := private.tg_remind_message(p_debtor, v_uid, v_net);
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

-- The link page. p_open = false is a plain view (a link preview must not count as «opened Kaspi»).
create function public.pay_link_open(p_secret text, p_code text, p_open boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l public.pay_links;
  v_net bigint;
  v_to_name text;
  v_from_name text;
  v_phone text;
  v_state text;
  v_prompt uuid;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select * into v_l from public.pay_links l where l.code = p_code and l.expires_at > now();
  if not found
     or not exists (select 1 from public.members m where m.household_id = v_l.household_id and m.user_id = v_l.from_user and m.active)
     or not exists (select 1 from public.members m where m.household_id = v_l.household_id and m.user_id = v_l.to_user and m.active) then
    return jsonb_build_object('state', 'expired');
  end if;

  if coalesce(p_open, false) then
    perform private.lock_pair(v_l.household_id, v_l.from_user, v_l.to_user);
  end if;
  v_net := private.pair_net(v_l.household_id, v_l.from_user, v_l.to_user);
  select pr.display_name, pr.kaspi_phone into v_to_name, v_phone from public.profiles pr where pr.id = v_l.to_user;
  select pr.display_name into v_from_name from public.profiles pr where pr.id = v_l.from_user;

  v_state := case when v_net <= 0 then 'paid' when v_net < private.min_transfer() then 'small' else 'pay' end;
  if coalesce(p_open, false) and v_state = 'pay' then
    update public.pay_links l set opened_at = now() where l.code = v_l.code;
    v_prompt := (private.open_paid_prompt_for(v_l.from_user, v_l.household_id, v_l.to_user)).id;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'to_name', v_to_name,
    'to_phone', v_phone,
    'from_name', v_from_name,
    'amount', greatest(v_net, 0),
    'prompt_id', v_prompt
  );
end;
$$;

create function public.pay_link_answer(p_secret text, p_code text, p_prompt uuid, p_yes boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_l public.pay_links;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_code is null or p_prompt is null or p_yes is null then
    raise exception 'invalid' using errcode = '23514';
  end if;
  select * into v_l from public.pay_links l where l.code = p_code and l.expires_at > now();
  if not found then
    return jsonb_build_object('result', 'expired', 'to_name', '');
  end if;
  -- the prompt must be the one of exactly this pair: a link never answers for anybody else
  if not exists (
    select 1 from public.paid_prompts p
    where p.id = p_prompt and p.household_id = v_l.household_id and p.from_user = v_l.from_user and p.to_user = v_l.to_user
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  return private.paid_prompt_answer(v_l.from_user, p_prompt, p_yes);
end;
$$;

revoke all on function public.pay_link_open(text, text, boolean), public.pay_link_answer(text, text, uuid, boolean) from public, anon, authenticated;
grant execute on function public.pay_link_open(text, text, boolean), public.pay_link_answer(text, text, uuid, boolean) to anon;
