-- 0002_slice1_rpcs: the first end-to-end path (sign-in -> profile -> household -> equal purchase).
--
-- Every function here is `security definer` with `search_path = ''` (all references qualified) and
-- derives the actor from auth.uid(); clients never pass a user id. Clients still have NO direct
-- insert/update on members, shares or settlements (0001): these RPCs are the only way in.
--
--   upsert_profile(name, phone)                -> own profile row (avatar color is picked here)
--   join_household(code)                       -> household row, or NULL for ANY failed lookup
--   create_purchase_with_shares(...)           -> the saved purchase with its shares as jsonb (split recomputed in SQL)
--
-- join_household returns NULL instead of raising when the code is wrong: a raised exception would roll
-- back the attempt we just recorded and the rate limit (10 per user per hour) could never trip. The
-- client turns NULL into the same generic `join_failed` error as an exhausted limit, so nothing leaks
-- about whether a code exists.

-- ---------------------------------------------------------------- invite codes are matched case-insensitively

create unique index households_invite_code_upper_idx on public.households (upper(invite_code));

-- ---------------------------------------------------------------- rate-limit table (private, no client access)

create table private.join_attempts (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index join_attempts_user_at_idx on private.join_attempts (user_id, at desc);
alter table private.join_attempts enable row level security;
revoke all on table private.join_attempts from public, anon, authenticated;

-- ---------------------------------------------------------------- upsert_profile

create function public.upsert_profile(p_name text, p_phone text)
returns public.profiles
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_result public.profiles;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if char_length(v_name) not between 1 and 40 then
    raise exception 'invalid display name' using errcode = '23514';
  end if;
  if p_phone is null or p_phone !~ '^\+7\d{10}$' then
    raise exception 'invalid phone' using errcode = '23514';
  end if;

  insert into public.profiles (id, display_name, kaspi_phone, avatar_color)
  values (
    v_uid, v_name, p_phone,
    (array['blue', 'brown', 'purple'])[1 + (get_byte(decode(md5(v_uid::text), 'hex'), 0) % 3)]
  )
  on conflict (id) do update
    set display_name = excluded.display_name, kaspi_phone = excluded.kaspi_phone
  returning * into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- join_household

create function public.join_household(code text)
returns public.households
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_household public.households;
  v_recent integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid) then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;

  -- Serialize this user's attempts: without the lock, concurrent calls all read the same count and
  -- slip past the limit. The lock is released at the end of the transaction.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 0));

  -- keep the table small: only the last hour matters
  delete from private.join_attempts a where a.user_id = v_uid and a.at < now() - interval '1 hour';
  select count(*) into v_recent from private.join_attempts a where a.user_id = v_uid;
  if v_recent >= 10 then
    raise exception 'join_failed' using errcode = 'P0001';
  end if;
  insert into private.join_attempts (user_id) values (v_uid);

  -- an absurdly long code can never match: same answer as a wrong one, after the attempt was recorded
  if char_length(coalesce(code, '')) > 64 then
    return null;
  end if;

  select h.* into v_household
  from public.households h
  where upper(h.invite_code) = upper(regexp_replace(coalesce(code, ''), '[\s-]', '', 'g'));
  if not found then
    return null;
  end if;

  insert into public.members (household_id, user_id)
  values (v_household.id, v_uid)
  on conflict (household_id, user_id) do update
    -- coming back never restores an old admin role or an old "away" period
    set active = true, role = 'member', away_until = null
    where not public.members.active;
  return v_household;
end;
$$;

-- ---------------------------------------------------------------- create_purchase_with_shares
-- Same rule as src/lib/domain/split.ts (splitEqual): base = floor(amount / N); the remainder goes
-- 1 tenge at a time to NON-payers in participant order; the payer's own share is settled at once.

create function public.create_purchase_with_shares(
  p_household_id uuid,
  p_amount integer,
  p_description text,
  p_merchant text,
  p_participant_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_desc text := btrim(coalesce(p_description, ''));
  v_merchant text := nullif(btrim(coalesce(p_merchant, '')), '');
  v_n integer := coalesce(cardinality(p_participant_ids), 0);
  v_base integer;
  v_rem integer;
  v_id uuid;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_amount is null or p_amount not between 1 and 10000000 then
    raise exception 'amount must be 1..10000000' using errcode = '23514';
  end if;
  if char_length(v_desc) not between 1 and 200 or char_length(coalesce(v_merchant, '')) > 120 then
    raise exception 'invalid description' using errcode = '23514';
  end if;
  if v_n < 1 or v_n > 50 then
    raise exception 'between 1 and 50 participants' using errcode = '23514';
  end if;
  -- every participant must owe at least 1 tenge (same rule as the form and splitEqual's callers)
  if p_amount < v_n then
    raise exception 'amount is smaller than the number of participants' using errcode = '23514';
  end if;
  if (select count(distinct x) from unnest(p_participant_ids) as x) <> v_n then
    raise exception 'participants must be a non-empty list without duplicates' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(p_participant_ids) as x
    where not exists (
      select 1 from public.members m
      where m.household_id = p_household_id and m.user_id = x and m.active
    )
  ) then
    raise exception 'every participant must be an active member' using errcode = '23503';
  end if;

  v_base := p_amount / v_n;          -- integer division = floor for positive numbers
  v_rem := p_amount - v_base * v_n;

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status)
  values (p_household_id, v_uid, p_amount, v_desc, v_merchant, 'manual', 'shared')
  returning id into v_id;

  insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at)
  select
    v_id, p_household_id, t.pid,
    v_base + case when t.pid <> v_uid and t.non_payer_rank <= v_rem then 1 else 0 end,
    case when t.pid = v_uid then now() end
  from (
    select u.pid, u.ord, count(*) filter (where u.pid <> v_uid) over (order by u.ord) as non_payer_rank
    from unnest(p_participant_ids) with ordinality as u(pid, ord)
  ) t;

  select to_jsonb(p) || jsonb_build_object(
    'shares',
    coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'purchase_id', s.purchase_id, 'debtor_id', s.debtor_id, 'amount', s.amount,
           'settled_at', s.settled_at, 'settlement_id', s.settlement_id
         ) order by s.debtor_id)
       from public.shares s where s.purchase_id = p.id),
      '[]'::jsonb
    )
  )
  into v_result
  from public.purchases p
  where p.id = v_id;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.upsert_profile(text, text) from public, anon, authenticated;
revoke all on function public.join_household(text) from public, anon, authenticated;
revoke all on function public.create_purchase_with_shares(uuid, integer, text, text, uuid[]) from public, anon, authenticated;
grant execute on function public.upsert_profile(text, text) to authenticated;
grant execute on function public.join_household(text) to authenticated;
grant execute on function public.create_purchase_with_shares(uuid, integer, text, text, uuid[]) to authenticated;
