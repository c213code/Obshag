-- 0003_slice3_settlements: marking, confirming and cancelling a settlement (SDD §6.4, §7).
--
-- 0001 and 0002 are applied to the live project and are never edited; this file only adds.
--
-- Every function is `security definer` with `search_path = ''`, takes the actor from auth.uid() and runs in
-- one transaction. Clients still cannot write `settlements` or `shares` directly (0001): these RPCs are the
-- only way in. Amounts never come from the client.
--
--   mark_settlement(household, to)  debtor marks "я оплатил". Under the pair lock it RECORDS the exact open shares
--                                   between the pair (both directions) in settlement_shares and derives the amount from
--                                   those rows. Asking again refreshes the record (same row, current set, current amount).
--   confirm_settlement(id, expected_amount?)        creditor confirms. It closes exactly the recorded shares, and only if every one of
--                                   them is still open and its purchase is still `shared`; otherwise 23514 `stale_settlement`
--                                   and nothing changes (the client then cancels the row and asks the debtor to mark again).
--   cancel_settlement(id)           debtor or creditor withdraws a `marked` settlement.
--
-- Error codes (mapped by the repos): 28000 not signed in, 42501 not allowed, 23514 invalid state / nothing to settle /
-- stale_settlement, 23503 the counterparty is not an active member, P0002 settlement not found (also: not yours),
-- P0001 rate_limited (at most 20 mark/cancel calls per user per hour).

-- ---------------------------------------------------------------- the recorded set

-- purchase_id has NO foreign key on purpose: deleting a purchase cascades its shares away, and confirm must be able to
-- SEE that a recorded share is gone (stale) instead of the record vanishing with it.
create table public.settlement_shares (
  settlement_id uuid not null references public.settlements(id) on delete cascade,
  household_id  uuid not null references public.households(id) on delete cascade,
  purchase_id   uuid not null,
  debtor_id     uuid not null,
  amount        integer not null check (amount >= 0),
  primary key (settlement_id, purchase_id, debtor_id),
  foreign key (household_id, debtor_id) references public.members(household_id, user_id)
);
create index settlement_shares_household_idx on public.settlement_shares(household_id);

alter table public.settlement_shares enable row level security;
revoke all on table public.settlement_shares from public, anon, authenticated;
grant select on public.settlement_shares to authenticated;
create policy settlement_shares_select on public.settlement_shares for select to authenticated
  using (private.is_member(household_id));

-- ---------------------------------------------------------------- rate limit (private, no client access)

create table private.settlement_ops (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index settlement_ops_user_at_idx on private.settlement_ops (user_id, at desc);
alter table private.settlement_ops enable row level security;
revoke all on table private.settlement_ops from public, anon, authenticated;

create function private.check_settlement_rate(p_user uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
begin
  -- per-user lock: the count-then-insert below must not race. Always taken AFTER the pair lock (pair -> user -> row).
  perform pg_advisory_xact_lock(hashtextextended('ops:' || p_user::text, 0));
  delete from private.settlement_ops o where o.user_id = p_user and o.at < now() - interval '1 hour';
  if (select count(*) from private.settlement_ops o where o.user_id = p_user) >= 20 then
    raise exception 'rate_limited' using errcode = 'P0001';
  end if;
  insert into private.settlement_ops (user_id) values (p_user);
end;
$$;
revoke all on function private.check_settlement_rate(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers (private, no client access)

-- The open shares between two people, both directions. Same rule as src/lib/domain/netting.ts:
-- only open shares of SHARED purchases count; the payer's own share is never a debt.
create function private.open_pair_shares(p_household_id uuid, p_a uuid, p_b uuid)
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
$$;
revoke all on function private.open_pair_shares(uuid, uuid, uuid) from public, anon, authenticated;

-- Positive = `p_a` owes `p_b`, negative = `p_b` owes `p_a`, 0 = even. bigint: a big household cannot overflow it.
create function private.pair_net(p_household_id uuid, p_a uuid, p_b uuid)
returns bigint
language sql stable security definer
set search_path = ''
as $$
  select coalesce(sum(case when o.debtor_id = p_a then o.amount else -o.amount end), 0)::bigint
  from private.open_pair_shares(p_household_id, p_a, p_b) o
$$;
revoke all on function private.pair_net(uuid, uuid, uuid) from public, anon, authenticated;

-- one advisory lock per household + ordered pair: A->B and B->A calls queue on the same key
create function private.lock_pair(p_household_id uuid, p_a uuid, p_b uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended(p_household_id::text || ':' || least(p_a, p_b)::text || ':' || greatest(p_a, p_b)::text, 0)
  );
end;
$$;
revoke all on function private.lock_pair(uuid, uuid, uuid) from public, anon, authenticated;

-- (Re)writes the recorded set of one marked settlement from the CURRENT open shares and derives the amount from the
-- rows it wrote. Raises 23514 when the debtor does not owe anything any more. Call it under the pair lock.
create function private.record_settlement_shares(p_settlement_id uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_row public.settlements;
  v_amount bigint;
begin
  select * into v_row from public.settlements st where st.id = p_settlement_id;
  delete from public.settlement_shares ss where ss.settlement_id = v_row.id;
  insert into public.settlement_shares (settlement_id, household_id, purchase_id, debtor_id, amount)
  select v_row.id, v_row.household_id, o.purchase_id, o.debtor_id, o.amount
  from private.open_pair_shares(v_row.household_id, v_row.from_id, v_row.to_id) o;

  select coalesce(sum(case when ss.debtor_id = v_row.from_id then ss.amount else -ss.amount end), 0) into v_amount
  from public.settlement_shares ss where ss.settlement_id = v_row.id;
  if v_amount <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;
  update public.settlements st set amount = v_amount::integer where st.id = v_row.id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function private.record_settlement_shares(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- mark_settlement

create function public.mark_settlement(p_household_id uuid, p_to uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.settlements;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_household_id is null or p_to is null or not private.is_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  if p_to = v_uid then
    raise exception 'cannot settle with yourself' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.members m where m.household_id = p_household_id and m.user_id = p_to and m.active
  ) then
    raise exception 'counterparty is not an active member' using errcode = '23503';
  end if;

  -- serialize this pair before reading anything: two taps (or two phones) queue here, the second one sees the first one's row
  perform private.lock_pair(p_household_id, v_uid, p_to);
  perform private.check_settlement_rate(v_uid);

  select * into v_row from public.settlements st
  where st.household_id = p_household_id and st.from_id = v_uid and st.to_id = p_to and st.status = 'marked'
  order by st.marked_at desc, st.id
  limit 1
  for update;
  if found then
    -- idempotent: one open marked settlement per pair and direction, but its record follows the current open shares
    return private.record_settlement_shares(v_row.id);
  end if;

  if private.pair_net(p_household_id, v_uid, p_to) <= 0 then
    raise exception 'nothing to pay: you do not owe this person' using errcode = '23514';
  end if;

  insert into public.settlements (household_id, from_id, to_id, amount, status)
  values (p_household_id, v_uid, p_to, 1, 'marked') -- the amount is replaced right below, from the recorded rows
  returning * into v_row;
  return private.record_settlement_shares(v_row.id);
end;
$$;

-- ---------------------------------------------------------------- confirm_settlement

create function public.confirm_settlement(p_settlement_id uuid, p_expected_amount integer default null)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.settlements;
  v_n integer;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  -- lock order everywhere: pair advisory lock -> per-user lock -> row locks. So read unlocked first, lock the pair, then lock the row.
  select * into v_row from public.settlements st where st.id = p_settlement_id;
  -- one answer for "does not exist" and "not yours": nothing about other people's rows leaks
  if not found or v_uid not in (v_row.from_id, v_row.to_id) or not private.is_member(v_row.household_id) then
    raise exception 'settlement not found' using errcode = 'P0002';
  end if;
  if v_row.to_id <> v_uid then
    raise exception 'only the creditor can confirm' using errcode = '42501';
  end if;

  perform private.lock_pair(v_row.household_id, v_row.from_id, v_row.to_id);
  select * into v_row from public.settlements st where st.id = p_settlement_id for update;
  if not found then
    raise exception 'settlement not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'confirmed' then
    return v_row; -- confirming twice is a no-op
  end if;
  if v_row.status <> 'marked' then
    raise exception 'settlement is not open' using errcode = '23514';
  end if;

  -- the creditor confirms the amount they SAW; if the record was refreshed since, refuse
  if p_expected_amount is not null and p_expected_amount <> v_row.amount then
    raise exception 'stale_settlement' using errcode = '23514';
  end if;

  -- lock the covered share rows before judging them
  perform 1
  from public.shares s
  join public.settlement_shares ss on ss.purchase_id = s.purchase_id and ss.debtor_id = s.debtor_id
  where ss.settlement_id = v_row.id
  for update of s;

  -- Close exactly what was recorded at the mark. If any recorded share is gone, already settled, changed, or its purchase
  -- is no longer shared, the amount the debtor paid does not describe the books any more: refuse, change nothing.
  if not exists (select 1 from public.settlement_shares ss where ss.settlement_id = v_row.id)
     or exists (
       select 1
       from public.settlement_shares ss
       left join public.shares s on s.purchase_id = ss.purchase_id and s.debtor_id = ss.debtor_id
       left join public.purchases p on p.id = s.purchase_id
       where ss.settlement_id = v_row.id
         and (s.purchase_id is null or s.settled_at is not null or s.amount <> ss.amount or p.status <> 'shared')
     ) then
    raise exception 'stale_settlement' using errcode = '23514';
  end if;

  update public.shares s
  set settled_at = now(), settlement_id = v_row.id
  from public.settlement_shares ss
  where ss.settlement_id = v_row.id
    and s.purchase_id = ss.purchase_id
    and s.debtor_id = ss.debtor_id;
  get diagnostics v_n = row_count;
  -- every recorded share must have been closed, else roll everything back (under-close)
  if v_n <> (select count(*) from public.settlement_shares ss where ss.settlement_id = v_row.id) then
    raise exception 'stale_settlement' using errcode = '23514';
  end if;

  update public.settlements st
  set status = 'confirmed', confirmed_at = now()
  where st.id = v_row.id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- cancel_settlement

create function public.cancel_settlement(p_settlement_id uuid)
returns public.settlements
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.settlements;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  select * into v_row from public.settlements st where st.id = p_settlement_id;
  if not found or v_uid not in (v_row.from_id, v_row.to_id) or not private.is_member(v_row.household_id) then
    raise exception 'settlement not found' using errcode = 'P0002';
  end if;

  perform private.lock_pair(v_row.household_id, v_row.from_id, v_row.to_id);
  select * into v_row from public.settlements st where st.id = p_settlement_id for update;
  if not found then
    raise exception 'settlement not found' using errcode = 'P0002';
  end if;
  if v_row.status = 'cancelled' then
    return v_row; -- already withdrawn: a no-op
  end if;
  if v_row.status <> 'marked' then
    raise exception 'a confirmed settlement cannot be cancelled' using errcode = '23514';
  end if;

  perform private.check_settlement_rate(v_uid);
  update public.settlements st set status = 'cancelled' where st.id = v_row.id returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.mark_settlement(uuid, uuid) from public, anon, authenticated;
revoke all on function public.confirm_settlement(uuid, integer) from public, anon, authenticated;
revoke all on function public.cancel_settlement(uuid) from public, anon, authenticated;
grant execute on function public.mark_settlement(uuid, uuid) to authenticated;
grant execute on function public.confirm_settlement(uuid, integer) to authenticated;
grant execute on function public.cancel_settlement(uuid) to authenticated;
