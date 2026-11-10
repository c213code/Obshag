-- Slice 14: «Очередь» (duty rotation; cooking first).
--
-- Tables (RLS: household members select; every write goes through an RPC below):
--   duties, duty_members (ordered rotation), duty_overrides (swap / admin), duty_done, duty_swap_requests
--   private.duty_morning_log (idempotency of the 09:00 cron)
--
-- Assignee of a day (Asia/Almaty dates, computed, never materialised): an override wins; else a recorded «приготовил»
-- (duty_done) keeps the day with whoever did it; else rotation[(day - start_date) mod n]. From today on, a member who is
-- away (away_until >= day) or inactive is skipped: the next available member in rotation order takes the day.
--
-- Errors are P0001 with a fixed message: busy, stale, not_assignee, past_day, future_day, locked, expired.
--
-- Anon surface 7 -> 9: run_duty_morning(secret), tg_respond_swap(secret, tg_user_id, request, accept); both raise 28000
-- without the 'cron' server secret. Everything is security definer with search_path = ''.

create table public.duties (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  kind         text not null check (kind in ('cooking', 'trash', 'water', 'custom')),
  title        text not null check (char_length(title) between 1 and 40),
  start_date   date not null,
  active       boolean not null default true,
  created_by   uuid references public.profiles(id),
  created_at   timestamptz not null default now()
);
create unique index duties_one_active_kind on public.duties (household_id, kind)
  where active and kind in ('cooking', 'trash', 'water');

create table public.duty_members (
  duty_id  uuid not null references public.duties(id) on delete cascade,
  user_id  uuid not null references public.profiles(id),
  position int not null check (position >= 0),
  primary key (duty_id, user_id),
  unique (duty_id, position)
);

create table public.duty_overrides (
  duty_id uuid not null references public.duties(id) on delete cascade,
  day     date not null,
  user_id uuid not null references public.profiles(id),
  source  text not null check (source in ('swap', 'admin')),
  reason  text check (reason is null or char_length(reason) <= 140),
  primary key (duty_id, day)
);

create table public.duty_done (
  duty_id uuid not null references public.duties(id) on delete cascade,
  day     date not null,
  user_id uuid not null references public.profiles(id),
  done_at timestamptz not null default now(),
  primary key (duty_id, day)
);

create table public.duty_swap_requests (
  id         uuid primary key default gen_random_uuid(),
  duty_id    uuid not null references public.duties(id) on delete cascade,
  from_user  uuid not null references public.profiles(id),
  from_day   date not null,
  to_user    uuid not null references public.profiles(id),
  to_day     date not null,
  reason     text check (reason is null or char_length(reason) <= 140),
  status     text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_user <> to_user and from_day <> to_day)
);
create index duty_swap_requests_duty_idx on public.duty_swap_requests (duty_id, status);

create table private.duty_morning_log (
  duty_id uuid not null references public.duties(id) on delete cascade,
  day     date not null,
  primary key (duty_id, day)
);
alter table private.duty_morning_log enable row level security;
revoke all on private.duty_morning_log from public, anon, authenticated;

-- ---------------------------------------------------------------- RLS

create function private.duty_visible(p_duty uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.duties d
    join public.members m on m.household_id = d.household_id
    where d.id = p_duty and m.user_id = auth.uid() and m.active
  );
$$;
revoke all on function private.duty_visible(uuid) from public, anon, authenticated;
grant execute on function private.duty_visible(uuid) to authenticated;

alter table public.duties             enable row level security;
alter table public.duty_members       enable row level security;
alter table public.duty_overrides     enable row level security;
alter table public.duty_done          enable row level security;
alter table public.duty_swap_requests enable row level security;

create policy duties_select on public.duties for select to authenticated using (private.is_member(household_id));
create policy duty_members_select on public.duty_members for select to authenticated using (private.duty_visible(duty_id));
create policy duty_overrides_select on public.duty_overrides for select to authenticated using (private.duty_visible(duty_id));
create policy duty_done_select on public.duty_done for select to authenticated using (private.duty_visible(duty_id));
create policy duty_swap_requests_select on public.duty_swap_requests for select to authenticated using (private.duty_visible(duty_id));

revoke all on public.duties, public.duty_members, public.duty_overrides, public.duty_done, public.duty_swap_requests from anon, authenticated;
grant select on public.duties, public.duty_members, public.duty_overrides, public.duty_done, public.duty_swap_requests to authenticated;

-- ---------------------------------------------------------------- helpers

create function private.almaty_today()
returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Almaty')::date $$;

-- «пн 17»
create function private.duty_day_label(p date)
returns text
language sql immutable
set search_path = ''
as $$
  select (array['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'])[extract(isodow from p)::int] || ' ' || extract(day from p)::int
$$;

-- @username, else the plain display name (no HTML escaping: Telegram messages sent by the app are plain text)
create function private.duty_tag(p_user uuid)
returns text
language sql stable
set search_path = ''
as $$
  select coalesce('@' || pr.telegram_username, nullif(pr.display_name, ''), '?') from public.profiles pr where pr.id = p_user
$$;

-- Who has the day, how it came about, and who it would have been without a skip.
create function private.duty_resolve(p_duty uuid, p_day date)
returns table (r_user uuid, r_source text, r_plain uuid)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_n int;
  v_idx int;
  v_i int;
  v_cand uuid;
  v_plain uuid;
  v_src text;
  v_today date := private.almaty_today();
begin
  select * into v_d from public.duties d where d.id = p_duty;
  if not found then
    return;
  end if;
  select o.user_id, o.source into v_cand, v_src from public.duty_overrides o where o.duty_id = p_duty and o.day = p_day;
  if found then
    return query select v_cand, v_src, v_cand;
    return;
  end if;
  select x.user_id into v_cand from public.duty_done x where x.duty_id = p_duty and x.day = p_day;
  if found then
    return query select v_cand, 'rotation'::text, v_cand;
    return;
  end if;
  select count(*) into v_n from public.duty_members dm where dm.duty_id = p_duty;
  if v_n = 0 or p_day < v_d.start_date then
    return;
  end if;
  v_idx := (p_day - v_d.start_date) % v_n;
  select dm.user_id into v_plain from public.duty_members dm where dm.duty_id = p_duty and dm.position = v_idx;
  if p_day < v_today then
    return query select v_plain, 'rotation'::text, v_plain;
    return;
  end if;
  for v_i in 0 .. v_n - 1 loop
    v_cand := null;
    select dm.user_id into v_cand
    from public.duty_members dm
    join public.members m on m.household_id = v_d.household_id and m.user_id = dm.user_id
    where dm.duty_id = p_duty and dm.position = (v_idx + v_i) % v_n
      and m.active and (m.away_until is null or m.away_until < p_day);
    if v_cand is not null then
      return query select v_cand, (case when v_i = 0 then 'rotation' else 'skip' end)::text, v_plain;
      return;
    end if;
  end loop;
  return query select v_plain, 'rotation'::text, v_plain; -- everybody is away: the plain rotation stands
end;
$$;

create function private.duty_assignee(p_duty uuid, p_day date)
returns uuid
language sql stable
set search_path = ''
as $$ select r.r_user from private.duty_resolve(p_duty, p_day) r $$;

-- Default order = join order; otherwise exactly the given distinct active members.
create function private.duty_clean_order(p_household uuid, p_order uuid[])
returns uuid[]
language plpgsql stable
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_order is null or cardinality(p_order) = 0 then
    select array_agg(m.user_id order by m.joined_at, m.user_id) into v_ids
    from public.members m where m.household_id = p_household and m.active;
    if v_ids is null then
      raise exception 'no members' using errcode = '23514';
    end if;
    return v_ids;
  end if;
  if cardinality(p_order) > 20
     or (select count(distinct u) from unnest(p_order) u) <> cardinality(p_order)
     or exists (
       select 1 from unnest(p_order) u
       where not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = u and m.active)
     )
  then
    raise exception 'invalid order' using errcode = '23514';
  end if;
  return p_order;
end;
$$;

create function private.duty_set_members(p_duty uuid, p_order uuid[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.duty_members dm where dm.duty_id = p_duty;
  insert into public.duty_members (duty_id, user_id, position)
  select p_duty, u.id, u.ord - 1 from unnest(p_order) with ordinality as u(id, ord);
end;
$$;

-- ---------------------------------------------------------------- schedule

create function public.duty_schedule(p_duty uuid, p_from date, p_to date)
returns table (day date, user_id uuid, source text, done boolean, request_id uuid, skipped_user uuid)
language plpgsql stable security definer
set search_path = ''
as $$
#variable_conflict use_column
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.duty_visible(p_duty) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 62 then
    raise exception 'invalid range' using errcode = '23514';
  end if;
  return query
  select g.d::date, r.r_user, r.r_source,
         exists (select 1 from public.duty_done x where x.duty_id = p_duty and x.day = g.d::date),
         (select q.id from public.duty_swap_requests q
          where q.duty_id = p_duty and q.status = 'pending' and q.expires_at > now() and g.d::date in (q.from_day, q.to_day)
          order by q.created_at limit 1),
         case when r.r_source = 'skip' then r.r_plain else null end
  from generate_series(p_from::timestamp, p_to::timestamp, interval '1 day') g(d)
  cross join lateral private.duty_resolve(p_duty, g.d::date) r
  order by 1;
end;
$$;

-- ---------------------------------------------------------------- create / order / assign (admins)

create function public.create_duty(p_household uuid, p_kind text, p_title text, p_start date, p_order uuid[])
returns public.duties
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_title text := btrim(coalesce(p_title, ''));
  v_order uuid[];
  v_d public.duties;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = v_uid and m.active and m.role = 'admin') then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('cooking', 'trash', 'water', 'custom') or char_length(v_title) not between 1 and 40 then
    raise exception 'invalid duty' using errcode = '23514';
  end if;
  v_order := private.duty_clean_order(p_household, p_order);
  insert into public.duties (household_id, kind, title, start_date, created_by)
  values (p_household, p_kind, v_title, coalesce(p_start, private.almaty_today()), v_uid)
  returning * into v_d; -- a second active duty of the same kind: unique violation 23505
  perform private.duty_set_members(v_d.id, v_order);
  return v_d;
end;
$$;

create function public.set_duty_order(p_duty uuid, p_order uuid[], p_start date default null)
returns public.duties
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_d public.duties;
  v_order uuid[];
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select * into v_d from public.duties d where d.id = p_duty for update;
  if not found
     or not exists (select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = v_uid and m.active and m.role = 'admin')
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  v_order := private.duty_clean_order(v_d.household_id, p_order);
  perform private.duty_set_members(v_d.id, v_order);
  if p_start is not null then
    update public.duties d set start_date = p_start where d.id = v_d.id returning * into v_d;
  end if;
  return v_d;
end;
$$;

-- The «Не могу сегодня» fallback: an admin puts a member on a day (today or later). A null user clears the override.
create function public.admin_assign_day(p_duty uuid, p_day date, p_user uuid)
returns void
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
  if not found
     or not exists (select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = v_uid and m.active and m.role = 'admin')
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_day is null or p_day < private.almaty_today() then
    raise exception 'past_day' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.duty_done x where x.duty_id = p_duty and x.day = p_day) then
    raise exception 'locked' using errcode = 'P0001';
  end if;
  if p_user is null then
    delete from public.duty_overrides o where o.duty_id = p_duty and o.day = p_day and o.source = 'admin';
  else
    if not exists (select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = p_user and m.active) then
      raise exception 'invalid member' using errcode = '23514';
    end if;
    insert into public.duty_overrides (duty_id, day, user_id, source, reason)
    values (p_duty, p_day, p_user, 'admin', null)
    on conflict (duty_id, day) do update set user_id = excluded.user_id, source = 'admin', reason = null;
  end if;
  -- a pending swap that touches the day is no longer valid
  update public.duty_swap_requests q set status = 'cancelled', decided_at = now()
  where q.duty_id = p_duty and q.status = 'pending' and p_day in (q.from_day, q.to_day);
end;
$$;

-- ---------------------------------------------------------------- done

create function public.mark_duty_done(p_duty uuid, p_day date)
returns public.duty_done
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := private.almaty_today();
  v_hour int := extract(hour from (now() at time zone 'Asia/Almaty'));
  v_row public.duty_done;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.duty_visible(p_duty) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_day is null or p_day > v_today then
    raise exception 'future_day' using errcode = 'P0001';
  end if;
  -- yesterday stays open until the 09:00 cron of the next morning, older days are locked
  if p_day < v_today - 1 or (p_day = v_today - 1 and v_hour >= 9) then
    raise exception 'locked' using errcode = 'P0001';
  end if;
  if private.duty_assignee(p_duty, p_day) is distinct from v_uid then
    raise exception 'not_assignee' using errcode = 'P0001';
  end if;
  insert into public.duty_done (duty_id, day, user_id) values (p_duty, p_day, v_uid)
  on conflict (duty_id, day) do nothing;
  select * into v_row from public.duty_done x where x.duty_id = p_duty and x.day = p_day;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- swaps

create function public.request_swap(p_duty uuid, p_my_day date, p_other_day date, p_reason text)
returns public.duty_swap_requests
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := private.almaty_today();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  v_d public.duties;
  v_other uuid;
  v_expires timestamptz;
  v_row public.duty_swap_requests;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.duty_visible(p_duty) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_my_day is null or p_other_day is null or p_my_day = p_other_day
     or (v_reason is not null and char_length(v_reason) > 140) then
    raise exception 'invalid swap' using errcode = '23514';
  end if;
  if p_my_day < v_today or p_other_day < v_today then
    raise exception 'past_day' using errcode = 'P0001';
  end if;

  -- lock order: duty row, then (below) the request rows
  select * into v_d from public.duties d where d.id = p_duty for update;
  update public.duty_swap_requests q set status = 'expired', decided_at = now()
  where q.duty_id = p_duty and q.status = 'pending' and q.expires_at <= now();

  if private.duty_assignee(p_duty, p_my_day) is distinct from v_uid then
    raise exception 'not_assignee' using errcode = 'P0001';
  end if;
  v_other := private.duty_assignee(p_duty, p_other_day);
  if v_other is null or v_other = v_uid then
    raise exception 'invalid swap' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.duty_swap_requests q
    where q.duty_id = p_duty and q.status = 'pending' and (q.from_day in (p_my_day, p_other_day) or q.to_day in (p_my_day, p_other_day))
  ) then
    raise exception 'busy' using errcode = 'P0001';
  end if;
  v_expires := (least(p_my_day, p_other_day)::timestamp + interval '10 hours') at time zone 'Asia/Almaty';
  if v_expires <= now() then
    raise exception 'expired' using errcode = 'P0001';
  end if;
  insert into public.duty_swap_requests (duty_id, from_user, from_day, to_user, to_day, reason, expires_at)
  values (p_duty, v_uid, p_my_day, v_other, p_other_day, v_reason, v_expires)
  returning * into v_row;
  return v_row;
end;
$$;

-- The one place a swap is decided (the app and the Telegram button both come through here).
create function private.duty_respond(p_actor uuid, p_request uuid, p_accept boolean)
returns public.duty_swap_requests
language plpgsql security definer
set search_path = ''
as $$
declare
  v_duty uuid;
  v_d public.duties;
  v_r public.duty_swap_requests;
  v_chat bigint;
begin
  select q.duty_id into v_duty from public.duty_swap_requests q where q.id = p_request;
  if v_duty is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- lock order: duty row, then the request row
  select * into v_d from public.duties d where d.id = v_duty for update;
  select * into v_r from public.duty_swap_requests q where q.id = p_request for update;
  if v_r.to_user <> p_actor
     or not exists (select 1 from public.members m where m.household_id = v_d.household_id and m.user_id = p_actor and m.active)
  then
    raise exception 'not allowed' using errcode = '42501';
  end if;

  if v_r.status = 'pending' and v_r.expires_at <= now() then
    update public.duty_swap_requests q set status = 'expired', decided_at = now() where q.id = v_r.id returning * into v_r;
    return v_r;
  end if;
  if v_r.status = 'expired' then
    return v_r;
  end if;
  if v_r.status <> 'pending' then
    -- the same decision twice is a no-op, anything else lost the race
    if (v_r.status = 'accepted' and p_accept) or (v_r.status = 'declined' and not p_accept) then
      return v_r;
    end if;
    raise exception 'stale' using errcode = 'P0001';
  end if;

  if not p_accept then
    update public.duty_swap_requests q set status = 'declined', decided_at = now() where q.id = v_r.id returning * into v_r;
    return v_r;
  end if;

  if private.duty_assignee(v_r.duty_id, v_r.from_day) is distinct from v_r.from_user
     or private.duty_assignee(v_r.duty_id, v_r.to_day) is distinct from v_r.to_user
  then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  insert into public.duty_overrides (duty_id, day, user_id, source, reason) values
    (v_r.duty_id, v_r.from_day, v_r.to_user, 'swap', v_r.reason),
    (v_r.duty_id, v_r.to_day, v_r.from_user, 'swap', v_r.reason)
  on conflict (duty_id, day) do update set user_id = excluded.user_id, source = 'swap', reason = excluded.reason;
  update public.duty_swap_requests q set status = 'accepted', decided_at = now() where q.id = v_r.id returning * into v_r;

  begin
    select h.telegram_chat_id into v_chat from public.households h where h.id = v_d.household_id;
    if v_chat is not null then
      perform private.tg_send(
        v_chat,
        '⇄ ' || private.tg_tag(v_r.from_user) || ' и ' || private.tg_tag(v_r.to_user) || ' поменялись: '
          || private.duty_day_label(v_r.from_day) || ' ⇄ ' || private.duty_day_label(v_r.to_day)
      );
    end if;
  exception when others then
    null; -- Telegram must never undo an accepted swap
  end;
  return v_r;
end;
$$;

create function public.respond_swap(p_request uuid, p_accept boolean)
returns public.duty_swap_requests
language plpgsql security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_accept is null then
    raise exception 'invalid' using errcode = '23514';
  end if;
  return private.duty_respond(auth.uid(), p_request, p_accept);
end;
$$;

create function public.cancel_swap(p_request uuid)
returns public.duty_swap_requests
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_duty uuid;
  v_r public.duty_swap_requests;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select q.duty_id into v_duty from public.duty_swap_requests q where q.id = p_request;
  if v_duty is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  perform 1 from public.duties d where d.id = v_duty for update;
  select * into v_r from public.duty_swap_requests q where q.id = p_request for update;
  if v_r.from_user <> v_uid then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if v_r.status = 'pending' then
    update public.duty_swap_requests q
    set status = case when q.expires_at <= now() then 'expired' else 'cancelled' end, decided_at = now()
    where q.id = v_r.id returning * into v_r;
  elsif v_r.status = 'accepted' then
    raise exception 'stale' using errcode = 'P0001';
  end if;
  return v_r;
end;
$$;

-- ---------------------------------------------------------------- notices (push / Telegram payloads)

create function private.duty_notice(p_request public.duty_swap_requests, p_target uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'request_id', p_request.id,
    'target_user', p_target,
    'subscriptions', private.subscriptions_of(p_target),
    'telegram_user_id', (select pr.telegram_user_id from public.profiles pr where pr.id = p_target),
    'from_name', private.duty_tag(p_request.from_user),
    'to_name', private.duty_tag(p_request.to_user),
    'from_day', p_request.from_day,
    'to_day', p_request.to_day,
    'from_label', private.duty_day_label(p_request.from_day),
    'to_label', private.duty_day_label(p_request.to_day),
    'reason', p_request.reason
  )
$$;
revoke all on function private.duty_notice(public.duty_swap_requests, uuid) from public, anon, authenticated;

-- Authenticated AND server-secret gated (like remind): the other party's devices never reach a browser.
-- 'requested' (caller = requester, still pending) -> the counterparty; 'declined' (caller = the one who declined) -> requester.
create function public.swap_notice(p_secret text, p_request uuid, p_event text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_r public.duty_swap_requests;
begin
  if v_uid is null or not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  select * into v_r from public.duty_swap_requests q where q.id = p_request;
  if not found or v_uid not in (v_r.from_user, v_r.to_user) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_event = 'requested' and v_uid = v_r.from_user and v_r.status = 'pending' then
    return private.duty_notice(v_r, v_r.to_user);
  elsif p_event = 'declined' and v_uid = v_r.to_user and v_r.status = 'declined' then
    return private.duty_notice(v_r, v_r.from_user);
  end if;
  raise exception 'invalid' using errcode = '23514';
end;
$$;

-- ---------------------------------------------------------------- Telegram buttons

create function public.tg_respond_swap(p_secret text, p_tg_user_id bigint, p_request uuid, p_accept boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_actor uuid;
  v_r public.duty_swap_requests;
begin
  if not private.server_secret_ok(p_secret) then
    raise exception 'unauthorized' using errcode = '28000';
  end if;
  if p_tg_user_id is null or p_request is null or p_accept is null then
    raise exception 'invalid' using errcode = '23514';
  end if;
  select pr.id into v_actor from public.profiles pr where pr.telegram_user_id = p_tg_user_id;
  if v_actor is null then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  begin
    v_r := private.duty_respond(v_actor, p_request, p_accept);
  exception when sqlstate 'P0001' then
    return jsonb_build_object('result', 'stale'); -- the schedule changed under the request
  end;
  return jsonb_build_object(
    'result', v_r.status,
    'notice', case when v_r.status = 'declined' then private.duty_notice(v_r, v_r.from_user) else null end
  );
end;
$$;

-- ---------------------------------------------------------------- the 09:00 cron

create function public.run_duty_morning(p_secret text)
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
    where d.active and exists (select 1 from public.duty_members dm where dm.duty_id = d.id)
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

revoke all on function private.almaty_today(), private.duty_day_label(date), private.duty_tag(uuid),
  private.duty_resolve(uuid, date), private.duty_assignee(uuid, date), private.duty_clean_order(uuid, uuid[]),
  private.duty_set_members(uuid, uuid[]), private.duty_respond(uuid, uuid, boolean) from public, anon, authenticated;

revoke all on function public.duty_schedule(uuid, date, date), public.create_duty(uuid, text, text, date, uuid[]),
  public.set_duty_order(uuid, uuid[], date), public.admin_assign_day(uuid, date, uuid), public.mark_duty_done(uuid, date),
  public.request_swap(uuid, date, date, text), public.respond_swap(uuid, boolean), public.cancel_swap(uuid),
  public.swap_notice(text, uuid, text), public.tg_respond_swap(text, bigint, uuid, boolean),
  public.run_duty_morning(text) from public, anon, authenticated;

grant execute on function public.duty_schedule(uuid, date, date), public.create_duty(uuid, text, text, date, uuid[]),
  public.set_duty_order(uuid, uuid[], date), public.admin_assign_day(uuid, date, uuid), public.mark_duty_done(uuid, date),
  public.request_swap(uuid, date, date, text), public.respond_swap(uuid, boolean), public.cancel_swap(uuid),
  public.swap_notice(text, uuid, text) to authenticated;
grant execute on function public.tg_respond_swap(text, bigint, uuid, boolean), public.run_duty_morning(text) to anon;
