-- Slice 20: Apple Pay without a menu in the Shortcut. A capture with no choice lands as pending and, besides the web push,
-- the bot DMs the payer «🛒 Magnum · 3 000 ₸ / Чья покупка?» with [Общее] [Моё] (callback s:<id> / p:<id>, handled by the
-- existing webhook) and a «Разобрать в приложении» link. Both survive a locked phone.
-- Same signature and body as 0008, plus the DM. An explicit choice = 'later' / 'потом' (old Shortcuts with the menu) stays
-- pending without a DM; a deduped retry sends nothing; a failed send never fails the capture.

create or replace function public.capture_purchase(p_token text, p_amount integer, p_merchant text, p_choice text default null)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_uid uuid;
  v_hh uuid;
  -- strip C0/C1 control characters and bidi overrides/isolates/marks before anything is stored or pushed
  v_merchant text := nullif(btrim(regexp_replace(coalesce(p_merchant, ''), '[\x01-\x1f\x7f-\x9f‎‏‪-‮⁦-⁩]', '', 'g')), '');
  v_choice text := lower(btrim(coalesce(p_choice, '')));
  v_status text := 'pending';
  v_today date := (now() at time zone 'Asia/Almaty')::date;
  v_ids uuid[];
  v_id uuid;
  v_subs jsonb := '[]'::jsonb;
  v_later boolean := v_choice in ('later', 'потом');
  v_tg bigint;
begin
  if p_token is null or char_length(p_token) not between 20 and 200 then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  v_hash := encode(extensions.digest(p_token, 'sha256'), 'hex');
  select t.user_id into v_uid from public.capture_tokens t where t.token_hash = v_hash;
  if v_uid is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;

  -- 30 captures per user (= per token) per hour; the lock keeps count-then-insert from racing
  perform pg_advisory_xact_lock(hashtextextended('capture:' || v_uid::text, 0));
  delete from private.capture_ops o where o.user_id = v_uid and o.at < now() - interval '1 hour';
  if (select count(*) from private.capture_ops o where o.user_id = v_uid) >= 30 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;

  if p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'amount must be 1..10000000' using errcode = '23514';
  end if;
  if char_length(coalesce(v_merchant, '')) > 120 then
    raise exception 'invalid merchant' using errcode = '23514';
  end if;

  -- default household if the owner is still an active member there, else the most recently joined active one
  select p.default_household_id into v_hh from public.profiles p where p.id = v_uid;
  if v_hh is not null and not exists (
    select 1 from public.members m where m.household_id = v_hh and m.user_id = v_uid and m.active
  ) then
    v_hh := null;
  end if;
  if v_hh is null then
    select m.household_id into v_hh
    from public.members m
    where m.user_id = v_uid and m.active
    order by m.joined_at desc, m.household_id
    limit 1;
  end if;
  if v_hh is null then
    raise exception 'no_household' using errcode = '23514';
  end if;

  if v_choice in ('personal', 'моё', 'мое') then
    v_status := 'personal';
  elsif v_choice in ('shared', 'общее') then
    select array_agg(m.user_id order by m.joined_at, m.user_id) into v_ids
    from public.members m
    where m.household_id = v_hh and m.active and (m.away_until is null or m.away_until < v_today);
    if v_ids is null then
      select array_agg(m.user_id order by m.joined_at, m.user_id) into v_ids
      from public.members m where m.household_id = v_hh and m.active;
    end if;
    if v_ids is not null and p_amount >= cardinality(v_ids) then
      v_status := 'shared';
    end if;
  end if;

  -- a Shortcut retry (same amount, merchant and outcome within 60 s) returns the existing purchase, without a second push
  select p.id into v_id from public.purchases p
  where p.payer_id = v_uid and p.source = 'apple_pay' and p.status = v_status and p.amount = p_amount
    and p.merchant is not distinct from v_merchant and p.created_at > now() - interval '60 seconds'
  order by p.created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object(
      'status', v_status, 'purchase_id', v_id, 'household_id', v_hh, 'amount', p_amount, 'merchant', v_merchant,
      'subscriptions', '[]'::jsonb, 'deduped', true
    );
  end if;

  insert into private.capture_ops (user_id) values (v_uid);
  update public.capture_tokens t set last_used_at = now() where t.token_hash = v_hash;

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status)
  values (v_hh, v_uid, p_amount, coalesce(v_merchant, 'Покупка'), v_merchant, 'apple_pay', v_status)
  returning id into v_id;

  if v_status = 'shared' then
    perform private.insert_equal_shares(v_id, v_hh, v_uid, p_amount, v_ids);
  elsif v_status = 'pending' then
    select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
    into v_subs
    from public.push_subscriptions s
    where s.user_id = v_uid;

    -- slice20: ask in Telegram right away (an explicit «later» stays quiet); a failed send never fails the capture
    if not v_later then
      begin
        select p.telegram_user_id into v_tg from public.profiles p where p.id = v_uid;
        if v_tg is not null then
          perform private.tg_send_markup(
            v_tg,
            '🛒 ' || private.tg_esc(coalesce(v_merchant, 'Покупка')) || ' · ' || private.tg_money(p_amount) || E'\nЧья покупка?',
            jsonb_build_object('inline_keyboard', jsonb_build_array(
              jsonb_build_array(
                jsonb_build_object('text', 'Общее', 'callback_data', 's:' || v_id),
                jsonb_build_object('text', 'Моё', 'callback_data', 'p:' || v_id)
              ),
              jsonb_build_array(jsonb_build_object('text', 'Разобрать в приложении', 'url', private.app_url() || '/pending/' || v_id))
            ))
          );
        end if;
      exception when others then
        null;
      end;
    end if;
  end if;

  return jsonb_build_object(
    'status', v_status, 'purchase_id', v_id, 'household_id', v_hh, 'amount', p_amount, 'merchant', v_merchant,
    'subscriptions', v_subs
  );
end;
$$;

revoke all on function public.capture_purchase(text, integer, text, text) from public, anon, authenticated;
grant execute on function public.capture_purchase(text, integer, text, text) to anon;
