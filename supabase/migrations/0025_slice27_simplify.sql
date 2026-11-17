-- Slice 27: simplify — fewer buttons and texts in Telegram.
-- 0001-0024 are LIVE and untouched; this file only replaces two functions with the same signatures.
--   1. private.tg_on_purchase (0020): the group purchase post is plain again — no «💸 <имя> → перевести» buttons and no
--      «Меньше 100 ₸ переводить не нужно…» footer. Paying happens from the app («К оплате») and the reminder button.
--      The telegram_sent dedupe and both exception guards stay. Pay links created earlier stay valid (old buttons work).
--   2. public.remind (0020): the dated «• 10 нояб · …» lines are not appended any more. private.tg_pair_lines stays
--      (unused). The single «💸 Перевести N ₸» button and everything else are unchanged.
-- Grants are unchanged; the anon surface is still 13 functions.

-- ---------------------------------------------------------------- 1. purchase post

-- 0020 tg_on_purchase; slice27: the plain post (as in 0007), no per-debtor buttons, no footer
create or replace function private.tg_on_purchase()
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
    if new.status = 'shared' and (tg_op = 'INSERT' or old.status = 'pending') then
      select h.telegram_chat_id into v_chat from public.households h where h.id = new.household_id;
      if v_chat is not null then
        insert into private.telegram_sent (kind, ref) values ('purchase', new.id) on conflict do nothing;
        get diagnostics v_new = row_count;
        if v_new then
          perform private.tg_send(v_chat, private.tg_purchase_message(new.id));
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

-- ---------------------------------------------------------------- 2. reminder

-- 0020 remind; slice27: no debt lines after the reminder text
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
      v_text := private.tg_remind_message(p_debtor, v_uid, v_net); -- slice27: no tg_pair_lines
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
