-- Slice 24: (A) the cooking queue walks past an away member, (B) the author can delete a purchase after people paid.
-- 0001-0021 are live and untouched. Replaced (latest definitions copied, only the described lines changed; create or
-- replace keeps the grants):
--   private.duty_resolve (0012), public.mark_duty_done (0012), public.run_duty_morning (0013), public.set_away (0006),
--   public.set_member_away (0021), public.delete_purchase (0009).
-- New: public.duty_chain, private.duty_chain_walk / duty_chain_lock / duty_chain_lock_household / duty_chain_backfill.
-- The anon surface does not change.
--
-- A. The chain. chain(d) = the next member after chain(d-1) in rotation order who is active and not away on d (everybody
-- unavailable: the plain rotation[(d - start) mod n]). Days with a stored row in duty_chain are fixed. A duty with no stored
-- row yet has the plain rotation for the days before yesterday, then the walk (this is also the backfill). Overrides and «приготовил» still win for display and do not move the chain. Past
-- days without a stored row show the plain rotation; today and later walk from the last stored row. With nobody away the
-- chain equals the plain rotation.

create table public.duty_chain (
  duty_id uuid not null references public.duties(id) on delete cascade,
  day     date not null,
  user_id uuid not null references public.profiles(id),
  primary key (duty_id, day)
);
alter table public.duty_chain enable row level security;
revoke all on public.duty_chain from anon, authenticated;
grant select on public.duty_chain to authenticated;
create policy duty_chain_select on public.duty_chain for select to authenticated using (private.duty_visible(duty_id));

-- The walk from the last stored day (or the start) through p_through, with the CURRENT away data. Writes nothing.
create function private.duty_chain_walk(p_duty uuid, p_through date)
returns table (w_day date, w_user uuid)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_ord uuid[];
  v_act boolean[];
  v_away date[];
  v_n int;
  v_last_day date;
  v_last_user uuid;
  v_day date;
  v_pos int;
  v_pick int;
  v_i int;
  v_c int;
  v_plain_before date := null; -- no stored row yet: the days before yesterday are the plain rotation
begin
  select * into v_d from public.duties d where d.id = p_duty;
  if not found then
    return;
  end if;
  select array_agg(dm.user_id order by dm.position), array_agg(coalesce(m.active, false) order by dm.position),
         array_agg(m.away_until order by dm.position)
    into v_ord, v_act, v_away
  from public.duty_members dm
  left join public.members m on m.household_id = v_d.household_id and m.user_id = dm.user_id
  where dm.duty_id = p_duty;
  v_n := coalesce(cardinality(v_ord), 0);
  if v_n = 0 then
    return;
  end if;
  select c.day, c.user_id into v_last_day, v_last_user from public.duty_chain c where c.duty_id = p_duty order by c.day desc limit 1;
  if found then
    v_day := v_last_day + 1;
    v_pos := array_position(v_ord, v_last_user) - 1;
    if v_pos is null then
      v_pos := (((v_last_day - v_d.start_date) % v_n) + v_n) % v_n;
    end if;
  else
    v_day := v_d.start_date;
    v_pos := v_n - 1;
    v_plain_before := private.almaty_today() - 1;
  end if;
  v_day := greatest(v_day, v_d.start_date);
  while v_day <= p_through loop
    v_pick := null;
    if v_plain_before is not null and v_day < v_plain_before then
      v_pick := (v_day - v_d.start_date) % v_n;
    end if;
    for v_i in 1 .. v_n loop
      exit when v_pick is not null;
      v_c := (v_pos + v_i) % v_n;
      if v_act[v_c + 1] and (v_away[v_c + 1] is null or v_away[v_c + 1] < v_day) then
        v_pick := v_c;
        exit;
      end if;
    end loop;
    if v_pick is null then
      v_pick := (v_day - v_d.start_date) % v_n; -- everybody unavailable: the plain rotation stands
    end if;
    return query select v_day, v_ord[v_pick + 1];
    v_pos := v_pick;
    v_day := v_day + 1;
  end loop;
end;
$$;

-- Freezes the chain through p_through. Idempotent.
create function private.duty_chain_lock(p_duty uuid, p_through date)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.duty_chain (duty_id, day, user_id)
  select p_duty, w.w_day, w.w_user from private.duty_chain_walk(p_duty, p_through) w
  on conflict (duty_id, day) do nothing;
end;
$$;

-- Locks every day-rotation duty of a household (called before an away change, through yesterday).
create function private.duty_chain_lock_household(p_household uuid, p_through date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in
    select d.id from public.duties d
    where d.household_id = p_household and d.kind in ('cooking', 'custom') and d.active
      and exists (select 1 from public.duty_members dm where dm.duty_id = d.id)
  loop
    perform private.duty_chain_lock(v_id, p_through);
  end loop;
end;
$$;

-- Who has the day, how it came about, and who the original rotation would have given it to. (0012 + the chain)
create or replace function private.duty_resolve(p_duty uuid, p_day date)
returns table (r_user uuid, r_source text, r_plain uuid)
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_n int;
  v_idx int;
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
  v_cand := null;
  select c.user_id into v_cand from public.duty_chain c where c.duty_id = p_duty and c.day = p_day;
  if v_cand is null then
    if p_day < v_today then
      return query select v_plain, 'rotation'::text, v_plain;
      return;
    end if;
    select w.w_user into v_cand from private.duty_chain_walk(p_duty, p_day) w where w.w_day = p_day;
  end if;
  if v_cand is null then
    v_cand := v_plain;
  end if;
  -- «skip» = a day the original rotation gave to somebody who is away (or gone)
  if v_cand is distinct from v_plain and not exists (
    select 1 from public.members m
    where m.household_id = v_d.household_id and m.user_id = v_plain and m.active and (m.away_until is null or m.away_until < p_day)
  ) then
    v_src := 'skip';
  else
    v_src := 'rotation';
  end if;
  return query select v_cand, v_src, v_plain;
end;
$$;

-- Backfill: plain rotation stored for the days before yesterday, then yesterday and today walked with the current away
-- data. Only duties without any chain row yet; «today» is computed at run time.
create function private.duty_chain_backfill()
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_today date := private.almaty_today();
  v_d record;
  v_n int;
begin
  for v_d in
    select d.id, d.start_date from public.duties d
    where d.kind in ('cooking', 'custom')
      and exists (select 1 from public.duty_members dm where dm.duty_id = d.id)
      and not exists (select 1 from public.duty_chain c where c.duty_id = d.id)
  loop
    select count(*) into v_n from public.duty_members dm where dm.duty_id = v_d.id;
    if v_d.start_date < v_today - 1 then
      insert into public.duty_chain (duty_id, day, user_id)
      select v_d.id, g.d::date, dm.user_id
      from generate_series(v_d.start_date::timestamp, (v_today - 2)::timestamp, interval '1 day') g(d)
      join public.duty_members dm on dm.duty_id = v_d.id and dm.position = (g.d::date - v_d.start_date) % v_n;
    end if;
    perform private.duty_chain_lock(v_d.id, v_today);
  end loop;
end;
$$;

select private.duty_chain_backfill();

revoke all on function private.duty_chain_walk(uuid, date), private.duty_chain_lock(uuid, date),
  private.duty_chain_lock_household(uuid, date), private.duty_chain_backfill() from public, anon, authenticated;

-- 0012 mark_duty_done: lock the chain through that day before the assignee check.
create or replace function public.mark_duty_done(p_duty uuid, p_day date)
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
  perform private.duty_chain_lock(p_duty, p_day); -- slice24
  if private.duty_assignee(p_duty, p_day) is distinct from v_uid then
    raise exception 'not_assignee' using errcode = 'P0001';
  end if;
  insert into public.duty_done (duty_id, day, user_id) values (p_duty, p_day, v_uid)
  on conflict (duty_id, day) do nothing;
  select * into v_row from public.duty_done x where x.duty_id = p_duty and x.day = p_day;
  return v_row;
end;
$$;

-- 0013 run_duty_morning: lock the chain through today before today / tomorrow are computed.
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
    perform private.duty_chain_lock(r.id, v_today); -- slice24
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

-- 0006 set_away: freeze history (through yesterday) before the away date changes.
create or replace function public.set_away(p_household uuid, p_until date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Almaty')::date;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_until is not null and (p_until < v_today or p_until > v_today + 366) then
    raise exception 'invalid date' using errcode = '23514';
  end if;
  if exists (select 1 from public.members m where m.household_id = p_household and m.user_id = v_uid and m.active) then
    perform private.duty_chain_lock_household(p_household, v_today - 1); -- slice24
  end if;
  update public.members set away_until = p_until where household_id = p_household and user_id = v_uid and active;
  if not found then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
end;
$$;

-- 0021 set_member_away: same freeze.
create or replace function public.set_member_away(p_household uuid, p_user uuid, p_until date)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'Asia/Almaty')::date;
  v_old date;
  v_chat bigint;
  v_text text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household is null or p_user is null
     or not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = v_uid and m.active)
     or not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_user and m.active) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_until is not null and (p_until < v_today or p_until > v_today + 366) then
    raise exception 'invalid date' using errcode = '23514';
  end if;

  perform private.duty_chain_lock_household(p_household, v_today - 1); -- slice24
  select m.away_until into v_old from public.members m
   where m.household_id = p_household and m.user_id = p_user for update;
  update public.members set away_until = p_until where household_id = p_household and user_id = p_user;

  if v_old is distinct from p_until then
    begin
      select h.telegram_chat_id into v_chat from public.households h where h.id = p_household;
      if v_chat is not null then
        if p_until is null then
          v_text := '🏠 ' || private.tg_tag(p_user) || ' снова дома';
        else
          v_text := '✈️ ' || private.tg_tag(p_user) || ' в отъезде до '
            || extract(day from p_until)::int::text || ' '
            || (array['янв','фев','мар','апр','мая','июн','июл','авг','сен','окт','нояб','дек'])[extract(month from p_until)::int]
            || ' — готовка идёт дальше по кругу';
        end if;
        if v_uid <> p_user then
          v_text := v_text || ' · отметил ' || private.tg_tag(v_uid);
        end if;
        perform private.tg_send(v_chat, v_text);
      end if;
    exception when others then
      null; -- never break the update
    end;
  end if;
end;
$$;

-- ---------------------------------------------------------------- B. the author deletes a paid purchase

-- 0009 delete_purchase. The has_payments block is gone: a debtor whose share was already settled paid for nothing, so a
-- compensating purchase «↩︎ Возврат» (the debtor paid, the old payer owes it back) is created; netting does the rest.
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
  v_new uuid;
  v_back text;
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

    -- every settled non-payer share: that debtor paid for nothing, the payer owes it back
    for v_s in
      select s.debtor_id, s.amount from public.shares s
      where s.purchase_id = p_id and s.debtor_id <> v_p.payer_id and s.settled_at is not null and s.amount > 0
      order by s.debtor_id
    loop
      v_new := gen_random_uuid();
      insert into private.telegram_sent (kind, ref) values ('purchase', v_new) on conflict do nothing; -- no purchase post for a refund
      insert into public.purchases (id, household_id, payer_id, amount, description, source, status)
      values (v_new, v_p.household_id, v_s.debtor_id, v_s.amount, left('↩︎ Возврат: ' || v_title, 200), 'manual', 'shared');
      insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at)
      values (v_new, v_p.household_id, v_p.payer_id, v_s.amount, null),
             (v_new, v_p.household_id, v_s.debtor_id, 0, now());
      v_back := coalesce(v_back || ', ', '') || private.tg_tag(v_s.debtor_id) || ' ' || private.tg_money(v_s.amount);
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
          '🗑 ' || private.tg_tag(v_uid) || ' удалил «' || private.tg_esc(v_title) || '» — ' || private.tg_money(v_p.amount)
          || case when v_back is null then '' else E'\nВернётся: ' || v_back end);
      end if;
    exception when others then
      null; -- Telegram must never break the delete
    end;
  end if;
end;
$$;
