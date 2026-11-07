-- Slice 9: Telegram group notifications.
-- Sending goes through pg_net + the bot token in Supabase Vault (secret `telegram_bot_token`).
-- pg_net / vault are enabled on the live project separately; every code path here is a clean no-op
-- when either is missing (PGlite tests, fresh projects). The token never appears in this repo.

-- ---------------------------------------------------------------- schema

alter table public.profiles
  add column telegram_username text check (telegram_username ~ '^[A-Za-z0-9_]{5,32}$');

-- the operator sets this with SQL for now; no client RPC
alter table public.households add column telegram_chat_id bigint;

-- telegram_username is written only through set_telegram_username (not by direct insert)
revoke insert on public.profiles from authenticated;
grant insert (id, display_name, kaspi_phone, avatar_color) on public.profiles to authenticated;

create table private.telegram_sent (
  kind    text not null check (kind in ('purchase', 'settlement')),
  ref     uuid not null,
  sent_at timestamptz not null default now(),
  primary key (kind, ref)
);
revoke all on private.telegram_sent from public, anon, authenticated;

-- ---------------------------------------------------------------- RPC

create function public.set_telegram_username(p_username text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  v_name := nullif(regexp_replace(btrim(coalesce(p_username, '')), '^@', ''), '');
  if v_name is not null and v_name !~ '^[A-Za-z0-9_]{5,32}$' then
    raise exception 'invalid_telegram_username' using errcode = '23514';
  end if;
  update public.profiles set telegram_username = v_name where id = v_uid;
  if not found then
    raise exception 'profile_required' using errcode = 'P0002';
  end if;
  return v_name;
end;
$$;
revoke all on function public.set_telegram_username(text) from public, anon, authenticated;
grant execute on function public.set_telegram_username(text) to authenticated;

-- ---------------------------------------------------------------- message builders (pure)

create function private.tg_esc(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select replace(replace(replace(coalesce(p, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- 6000 -> '6 000 ₸' (not locale dependent)
create function private.tg_money(p bigint)
returns text
language sql
immutable
set search_path = ''
as $$
  select regexp_replace(p::text, '(\d)(?=(\d{3})+$)', '\1 ', 'g') || ' ₸'
$$;

-- @username when set, else the escaped display name
create function private.tg_tag(p_user uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce('@' || pr.telegram_username, private.tg_esc(nullif(pr.display_name, '')), '?')
  from public.profiles pr where pr.id = p_user
$$;

create function private.tg_purchase_message(p_purchase uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_p public.purchases;
  v_title text;
  v_debts text;
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
  return (case when v_p.bill_id is not null then '🏠 ' else '🛒 ' end)
    || private.tg_esc(v_title) || ' — ' || private.tg_money(v_p.amount) || E'\n'
    || 'Платил: ' || private.tg_tag(v_p.payer_id)
    || case when v_debts is null then '' else E'\nДолжны:\n' || v_debts end;
end;
$$;

create function private.tg_settlement_message(p_settlement uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select '✅ ' || private.tg_tag(st.from_id) || ' → ' || private.tg_tag(st.to_id)
         || ' · ' || private.tg_money(st.amount) || ' · рассчитались'
  from public.settlements st where st.id = p_settlement
$$;

-- ---------------------------------------------------------------- sending

create function private.tg_send(p_chat bigint, p_text text)
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
          jsonb_build_object('chat_id', p_chat, 'text', p_text, 'parse_mode', 'HTML', 'disable_web_page_preview', true),
          '{"Content-Type": "application/json"}'::jsonb;
end;
$$;

create function private.tg_on_purchase()
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

create function private.tg_on_settlement()
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
          perform private.tg_send(v_chat, private.tg_settlement_message(new.id));
        end if;
      end if;
    end if;
  exception when others then
    null;
  end;
  return null;
end;
$$;

revoke all on function private.tg_esc(text), private.tg_money(bigint), private.tg_tag(uuid),
  private.tg_purchase_message(uuid), private.tg_settlement_message(uuid), private.tg_send(bigint, text),
  private.tg_on_purchase(), private.tg_on_settlement() from public, anon, authenticated;

-- deferred: shares are inserted after the purchase row in the same transaction
create constraint trigger tg_purchase_notify
  after insert or update on public.purchases
  deferrable initially deferred
  for each row execute function private.tg_on_purchase();

create constraint trigger tg_settlement_notify
  after update on public.settlements
  deferrable initially deferred
  for each row execute function private.tg_on_settlement();
