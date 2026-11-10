-- 0014_slice16_queue_fix_bill_icons: (A) event-queue pointer walks from the actor, (B) monthly bill icons.
-- Grants are kept by create or replace (same signatures).

-- A) after a trip the turn goes to the first member after the ACTOR who was not on that trip and is home.
create or replace function private.duty_current(p_duty uuid)
returns uuid
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_d public.duties;
  v_last public.duty_events;
  v_n int;
  v_start int := 0;
  v_i int;
  v_pos int;
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
    -- walk forward from the ACTOR; everybody in that trip (actor and partner) is skipped
    v_start := coalesce((select dm.position from public.duty_members dm where dm.duty_id = p_duty and dm.user_id = v_last.user_id), -1);
    for v_i in 1 .. v_n loop
      v_pos := (v_start + v_i) % v_n;
      v_cand := null;
      select dm.user_id into v_cand
      from public.duty_members dm
      join public.members m on m.household_id = v_d.household_id and m.user_id = dm.user_id
      where dm.duty_id = p_duty and dm.position = v_pos
        and dm.user_id is distinct from v_last.user_id and dm.user_id is distinct from v_last.partner_id
        and m.active and (m.away_until is null or m.away_until < v_today);
      if v_cand is not null then
        return v_cand;
      end if;
    end loop;
    -- nobody left: the plain next member after the actor
    select dm.user_id into v_cand from public.duty_members dm where dm.duty_id = p_duty and dm.position = (v_start + 1) % v_n;
    return v_cand;
  end if;
  for v_i in 0 .. v_n - 1 loop
    v_cand := null;
    select dm.user_id into v_cand
    from public.duty_members dm
    join public.members m on m.household_id = v_d.household_id and m.user_id = dm.user_id
    where dm.duty_id = p_duty and dm.position = v_i
      and m.active and (m.away_until is null or m.away_until < v_today);
    if v_cand is not null then
      return v_cand;
    end if;
  end loop;
  select dm.user_id into v_cand from public.duty_members dm where dm.duty_id = p_duty and dm.position = 0; -- everybody is away
  return v_cand;
end;
$$;

-- B) bill icons: home, internet, gas, utility, receipt. Old values are mapped first. The only check lived in upsert_bill.
update public.bills set icon = case icon when 'drop' then 'utility' when 'bolt' then 'utility' when 'wifi' then 'internet' else icon end
  where icon in ('drop', 'bolt', 'wifi');
update public.bills set icon = 'receipt' where icon not in ('home', 'internet', 'gas', 'utility', 'receipt');
alter table public.bills add constraint bills_icon_check check (icon in ('home', 'internet', 'gas', 'utility', 'receipt'));

create or replace function public.upsert_bill(
  p_household uuid, p_id uuid, p_title text, p_icon text, p_amount integer, p_variable boolean,
  p_day integer, p_payer uuid, p_participants uuid[]
)
returns public.bills
language plpgsql security definer
set search_path = ''
as $$
declare
  v_title text := btrim(coalesce(p_title, ''));
  v_n integer := coalesce(cardinality(p_participants), 0);
  v_row public.bills;
begin
  perform private.require_admin(p_household);
  if char_length(v_title) not between 1 and 60
     or p_icon is null or p_icon not in ('home', 'internet', 'gas', 'utility', 'receipt')
     or p_variable is null
     or p_day is null or p_day not between 1 and 28 then
    raise exception 'invalid bill' using errcode = '23514';
  end if;
  if p_variable then
    if p_amount is not null then
      raise exception 'a variable bill has no fixed amount' using errcode = '23514';
    end if;
  elsif p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'amount must be 1..10000000' using errcode = '23514';
  end if;
  if v_n < 1 or v_n > 50 or (select count(distinct x) from unnest(p_participants) as x) <> v_n then
    raise exception 'participants must be 1..50 distinct members' using errcode = '23514';
  end if;
  if not p_variable and p_amount < v_n then
    raise exception 'amount is smaller than the number of participants' using errcode = '23514';
  end if;
  if p_payer is null
     or not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = p_payer and m.active)
     or exists (
       select 1 from unnest(p_participants) as x
       where not exists (select 1 from public.members m where m.household_id = p_household and m.user_id = x and m.active)
     ) then
    raise exception 'payer and participants must be active members' using errcode = '23503';
  end if;

  if p_id is null then
    insert into public.bills (household_id, title, icon, amount, variable, day_of_month, payer_id, participants)
    values (p_household, v_title, p_icon, p_amount, p_variable, p_day, p_payer, p_participants)
    returning * into v_row;
  else
    update public.bills set title = v_title, icon = p_icon, amount = p_amount, variable = p_variable,
      day_of_month = p_day, payer_id = p_payer, participants = p_participants
    where id = p_id and household_id = p_household
    returning * into v_row;
    if not found then
      raise exception 'bill not found' using errcode = 'P0002';
    end if;
  end if;
  return v_row;
end;
$$;

