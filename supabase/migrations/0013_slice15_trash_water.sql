-- Slice 15: «Мусор» and «Вода» (event-based duties). 0001-0012 are LIVE and untouched; this file only adds.
--
-- These duties reuse public.duties (kind 'trash' | 'water') and its duty_members rotation, but nobody has a date: the
-- turn moves on FACT. public.duty_events records what happened (done / ping / empty); the current person is the member
-- after the last `done` carrier in rotation order (the first member while nothing is done yet). Members who are away
-- (away_until >= today) or inactive are skipped. A water trip of two moves the pointer past both (after the later one).
--
-- duty_events.partner_id: on `done` = the second carrier of a water trip; on `ping` / `empty` = the person who was
-- current (and got the push) at that moment.
--
-- Writes only through the RPCs below (security definer, search_path = '', actor auth.uid(), members only, the duty row
-- is locked first). Anon surface stays 9: nothing here is granted to anon. Telegram group lines go through tg_send;
-- push targets go through duty_event_notice (authenticated AND the server secret, like swap_notice).
--
-- Errors: P0001 rate_limited (hint = seconds left) for the cooldowns (ping 2 h, empty 1 h), 42501 not a member / admin,
-- 23514 wrong kind or invalid input.

alter table public.duties
  add column price_per_liter int not null default 20 check (price_per_liter between 1 and 1000),
  add column bottle_liters   int not null default 5  check (bottle_liters between 1 and 50),
  add column bottles_total   int not null default 4  check (bottles_total between 1 and 12),
  add column bottles_full    int not null default 4  check (bottles_full >= 0),
  add constraint duties_bottles_full_max check (bottles_full <= bottles_total);

create table public.duty_events (
  id          uuid primary key default gen_random_uuid(),
  duty_id     uuid not null references public.duties(id) on delete cascade,
  kind        text not null check (kind in ('done', 'ping', 'empty')),
  user_id     uuid not null references public.profiles(id),
  partner_id  uuid references public.profiles(id),
  liters      int check (liters is null or liters > 0),
  purchase_id uuid references public.purchases(id) on delete set null,
  created_at  timestamptz not null default clock_timestamp()
);
create index duty_events_duty_idx on public.duty_events (duty_id, created_at desc);

alter table public.duty_events enable row level security;
create policy duty_events_select on public.duty_events for select to authenticated using (private.duty_visible(duty_id));
revoke all on public.duty_events from anon, authenticated;
grant select on public.duty_events to authenticated;

-- ---------------------------------------------------------------- helpers

-- Whose turn it is now (null when the rotation is empty).
create function private.duty_current(p_duty uuid)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_last public.duty_events;
  v_n int;
  v_base int := -1;
  v_start int;
  v_i int;
  v_cand uuid;
  v_today date := private.almaty_today();
begin
  select * into v_d from public.duties d where d.id = p_duty;
  if not found then
    return null;
  end if;
  select count(*) into v_n from public.duty_members dm where dm.duty_id = p_duty;
  if v_n = 0 then
    return null;
  end if;
  select * into v_last from public.duty_events e where e.duty_id = p_duty and e.kind = 'done' order by e.created_at desc, e.id desc limit 1;
  if found then
    select greatest(
      coalesce((select dm.position from public.duty_members dm where dm.duty_id = p_duty and dm.user_id = v_last.user_id), -1),
      coalesce((select dm.position from public.duty_members dm where dm.duty_id = p_duty and dm.user_id = v_last.partner_id), -1)
    ) into v_base;
  end if;
  v_start := (v_base + 1) % v_n;
  for v_i in 0 .. v_n - 1 loop
    v_cand := null;
    select dm.user_id into v_cand
    from public.duty_members dm
    join public.members m on m.household_id = v_d.household_id and m.user_id = dm.user_id
    where dm.duty_id = p_duty and dm.position = (v_start + v_i) % v_n
      and m.active and (m.away_until is null or m.away_until < v_today);
    if v_cand is not null then
      return v_cand;
    end if;
  end loop;
  select dm.user_id into v_cand from public.duty_members dm where dm.duty_id = p_duty and dm.position = v_start; -- everybody is away
  return v_cand;
end;
$$;

-- Locks the duty row and checks: signed in, active member of its household, the duty has the expected kind.
create function private.duty_event_open(p_duty uuid, p_kind text)
returns public.duties
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_d public.duties;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_d from public.duties d where d.id = p_duty for update;
  if not found or not exists (
    select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = v_uid and m.active
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_d.kind <> p_kind or not v_d.active then
    raise exception 'invalid duty' using errcode = '23514';
  end if;
  return v_d;
end;
$$;

-- Raises rate_limited (hint = seconds left) when an event of `p_kind` happened less than `p_window` ago.
create function private.duty_event_cooldown(p_duty uuid, p_kind text, p_window interval)
returns void
language plpgsql stable
set search_path = ''
as $$
declare
  v_last timestamptz;
begin
  select max(e.created_at) into v_last from public.duty_events e where e.duty_id = p_duty and e.kind = p_kind;
  if v_last is not null and v_last > clock_timestamp() - p_window then
    raise exception 'rate_limited' using errcode = 'P0001',
      hint = greatest(1, ceil(extract(epoch from (v_last + p_window - clock_timestamp()))))::int::text;
  end if;
end;
$$;

create function private.duty_group_line(p_household uuid, p_text text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_chat bigint;
begin
  begin
    select h.telegram_chat_id into v_chat from public.households h where h.id = p_household;
    if v_chat is not null then
      perform private.tg_send(v_chat, p_text);
    end if;
  exception when others then
    null; -- Telegram must never undo the event
  end;
end;
$$;

-- ---------------------------------------------------------------- Мусор

create function public.duty_done_event(p_duty uuid)
returns public.duty_events
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_row public.duty_events;
begin
  v_d := private.duty_event_open(p_duty, 'trash');
  insert into public.duty_events (duty_id, kind, user_id) values (p_duty, 'done', auth.uid()) returning * into v_row;
  return v_row;
end;
$$;

create function public.duty_ping(p_duty uuid)
returns public.duty_events
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_cur uuid;
  v_row public.duty_events;
begin
  v_d := private.duty_event_open(p_duty, 'trash');
  perform private.duty_event_cooldown(p_duty, 'ping', interval '2 hours');
  v_cur := private.duty_current(p_duty);
  insert into public.duty_events (duty_id, kind, user_id, partner_id) values (p_duty, 'ping', auth.uid(), v_cur) returning * into v_row;
  if v_cur is not null then
    perform private.duty_group_line(v_d.household_id, '🗑 ' || private.tg_tag(v_cur) || ', пакет полный');
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- Вода

create function public.water_empty(p_duty uuid)
returns public.duty_events
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_cur uuid;
  v_row public.duty_events;
begin
  v_d := private.duty_event_open(p_duty, 'water');
  perform private.duty_event_cooldown(p_duty, 'empty', interval '1 hour');
  v_cur := private.duty_current(p_duty);
  insert into public.duty_events (duty_id, kind, user_id, partner_id) values (p_duty, 'empty', auth.uid(), v_cur) returning * into v_row;
  update public.duties d set bottles_full = 0 where d.id = p_duty;
  if v_cur is not null then
    perform private.duty_group_line(v_d.household_id, '💧 Вода кончилась, несёт ' || private.tg_tag(v_cur));
  end if;
  return v_row;
end;
$$;

-- «Принёс»: alone = 2 bottles, with a partner = 4. Records a SHARED purchase (payer = the caller) split equally between
-- the members who are home (everybody when nobody is), so netting, the Telegram purchase post and the Kaspi minimum apply.
create function public.water_brought(p_duty uuid, p_partner uuid default null)
returns public.duty_events
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_d public.duties;
  v_bottles int;
  v_liters int;
  v_amount int;
  v_today date := private.almaty_today();
  v_people uuid[];
  v_purchase uuid;
  v_row public.duty_events;
begin
  v_d := private.duty_event_open(p_duty, 'water');
  if p_partner is not null and (
    p_partner = v_uid or not exists (
      select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = p_partner and m.active
    )
  ) then
    raise exception 'invalid partner' using errcode = '23514';
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
  values (v_d.household_id, v_uid, v_amount, 'Вода ' || v_liters || ' л', 'manual', 'shared')
  returning id into v_purchase;
  perform private.insert_equal_shares(v_purchase, v_d.household_id, v_uid, v_amount, v_people);

  insert into public.duty_events (duty_id, kind, user_id, partner_id, liters, purchase_id)
  values (p_duty, 'done', v_uid, p_partner, v_liters, v_purchase) returning * into v_row;
  update public.duties d set bottles_full = least(v_bottles, d.bottles_total) where d.id = p_duty;
  return v_row;
end;
$$;

create function public.water_bottle_used(p_duty uuid)
returns public.duties
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.duties;
begin
  v_d := private.duty_event_open(p_duty, 'water');
  update public.duties d set bottles_full = greatest(0, d.bottles_full - 1) where d.id = p_duty returning * into v_d;
  return v_d;
end;
$$;

-- Admin only: the price of a liter.
create function public.set_water_price(p_duty uuid, p_price int)
returns public.duties
language plpgsql security definer
set search_path = ''
as $$
declare
  v_d public.duties;
begin
  v_d := private.duty_event_open(p_duty, 'water');
  if not exists (
    select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = auth.uid() and m.active and m.role = 'admin'
  ) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_price is null or p_price not between 1 and 1000 then
    raise exception 'invalid price' using errcode = '23514';
  end if;
  update public.duties d set price_per_liter = p_price where d.id = p_duty returning * into v_d;
  return v_d;
end;
$$;

-- ---------------------------------------------------------------- push payload

-- Authenticated AND server-secret gated: who to push after a ping / «вода кончилась». Only the caller's own, fresh event.
create function public.duty_event_notice(p_secret text, p_event uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_e public.duty_events;
  v_title text;
begin
  if v_uid is null or not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select * into v_e from public.duty_events e where e.id = p_event;
  if not found or v_e.user_id <> v_uid or v_e.kind not in ('ping', 'empty') or v_e.created_at < clock_timestamp() - interval '10 minutes' then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select d.title into v_title from public.duties d where d.id = v_e.duty_id;
  return jsonb_build_object(
    'event_id', v_e.id,
    'kind', v_e.kind,
    'title', v_title,
    'target_user', v_e.partner_id,
    'self', v_e.partner_id is not distinct from v_e.user_id,
    'actor_name', coalesce(nullif((select pr.display_name from public.profiles pr where pr.id = v_e.user_id), ''), '?'),
    'subscriptions', case
      when v_e.partner_id is null or v_e.partner_id = v_e.user_id then '[]'::jsonb
      else private.subscriptions_of(v_e.partner_id)
    end
  );
end;
$$;

-- ---------------------------------------------------------------- the 09:00 run: event duties have no day, skip them

create or replace function public.run_duty_morning(p_secret text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  r record;
  v_today date := private.almaty_today();
  v_out jsonb := '[]'::jsonb;
  v_cook uuid;
  v_next uuid;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  delete from private.duty_morning_log l where l.day < v_today - 14;
  update public.duty_swap_requests q set status = 'expired', decided_at = now() where q.status = 'pending' and q.expires_at <= now();

  for r in
    select d.id, d.household_id, d.kind, d.title, h.telegram_chat_id
    from public.duties d
    join public.households h on h.id = d.household_id
    where d.active and d.kind in ('cooking', 'custom') and exists (select 1 from public.duty_members dm where dm.duty_id = d.id)
      and not exists (select 1 from private.duty_morning_log l where l.duty_id = d.id and l.day = v_today)
    order by d.id
  loop
    insert into private.duty_morning_log (duty_id, day) values (r.id, v_today) on conflict do nothing;
    v_cook := private.duty_assignee(r.id, v_today);
    v_next := private.duty_assignee(r.id, v_today + 1);
    continue when v_cook is null;
    v_out := v_out || jsonb_build_object(
      'duty_id', r.id,
      'household_id', r.household_id,
      'kind', r.kind,
      'title', r.title,
      'telegram_chat_id', r.telegram_chat_id,
      'today_user', v_cook,
      'today_name', private.duty_tag(v_cook),
      'tomorrow_user', v_next,
      'tomorrow_name', case when v_next is null then null else private.duty_tag(v_next) end,
      'subscriptions', private.subscriptions_of(v_cook)
    );
  end loop;
  return v_out;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function private.duty_current(uuid), private.duty_event_open(uuid, text),
  private.duty_event_cooldown(uuid, text, interval), private.duty_group_line(uuid, text) from public, anon, authenticated;

revoke all on function public.duty_done_event(uuid), public.duty_ping(uuid), public.water_empty(uuid),
  public.water_brought(uuid, uuid), public.water_bottle_used(uuid), public.set_water_price(uuid, int),
  public.duty_event_notice(text, uuid) from public, anon, authenticated;
grant execute on function public.duty_done_event(uuid), public.duty_ping(uuid), public.water_empty(uuid),
  public.water_brought(uuid, uuid), public.water_bottle_used(uuid), public.set_water_price(uuid, int),
  public.duty_event_notice(text, uuid) to authenticated;
