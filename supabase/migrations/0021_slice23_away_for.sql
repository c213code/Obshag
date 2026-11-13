-- Slice 23: any active housemate can mark another housemate «в отъезде» (their cooking days go to the next in rotation).
-- The rotation already skips away members (0012/0014); only the writer was limited to the person themself (set_away, 0006).
-- public.set_away stays as is (old clients).

create function public.set_member_away(p_household uuid, p_user uuid, p_until date)
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

revoke all on function public.set_member_away(uuid, uuid, date) from public, anon, authenticated;
grant execute on function public.set_member_away(uuid, uuid, date) to authenticated;
