-- 0001_baseline: Общак schema (SDD §8) with row level security.
-- Money is stored as integer tenge.
--
-- SECURITY MODEL (pre-release: this file is edited in place until the first deploy)
--   * Default-deny. Every table has RLS on, grants are explicit and column-level where it matters.
--   * `anon` has no access to anything in `public`.
--   * Clients (role `authenticated`) can READ household data but may only WRITE
--       - their own profile, push subscriptions, purchases (as payer), `members.away_until`,
--       - `households.name` (admins).
--     Everything else (create/join/leave household, role changes, shares, settlements,
--     reminders, capture tokens) goes through security-definer RPCs or the service role
--     in later slices. Slice 0 ships only the lockdown plus `create_household`.
--   * Helper functions live in the `private` schema, which is NOT exposed through the API.
--
-- PROFILE FOREIGN KEY POLICY (L3)
--   * Personal, disposable data (push_subscriptions, capture_tokens, reminder_log):
--     ON DELETE CASCADE from profiles.
--   * Ledger data (households.created_by, members, purchases, shares, settlements, bills):
--     NO ACTION (restrict). Financial history must not vanish when an account is deleted;
--     leaving a household is a soft leave (members.active = false) and account deletion is an
--     anonymisation job in a later slice, never a hard delete of ledger rows.

-- ---------------------------------------------------------------- schemas and default privileges

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- Hosted Supabase grants ALL on new public objects to anon/authenticated by default.
-- Turn that off so every grant below is explicit.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated, public;
alter default privileges in schema private revoke all on functions from anon, authenticated, public;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  kaspi_phone  text,
  avatar_color text,
  created_at   timestamptz not null default now()
);

create table public.households (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 60),
  -- generated server-side (create_household); a short code would be guessable
  invite_code text not null unique check (char_length(invite_code) >= 10),
  created_by  uuid not null references public.profiles(id),
  created_at  timestamptz not null default now()
);

create table public.members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id      uuid not null references public.profiles(id),
  role         text not null default 'member' check (role in ('admin', 'member')),
  -- soft leave: ledger rows keep pointing at the member
  active       boolean not null default true,
  away_until   date,
  joined_at    timestamptz not null default now(),
  primary key (household_id, user_id)
);

create table public.purchases (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  payer_id     uuid not null,
  amount       integer not null check (amount > 0),
  description  text not null default '',
  merchant     text,
  source       text not null default 'manual' check (source in ('apple_pay', 'manual', 'monthly')),
  status       text not null default 'shared' check (status in ('pending', 'shared', 'personal')),
  created_at   timestamptz not null default now(),
  unique (id, household_id),
  foreign key (household_id, payer_id) references public.members(household_id, user_id)
);

create table public.settlements (
  id           uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  from_id      uuid not null,
  to_id        uuid not null,
  amount       integer not null check (amount > 0),
  status       text not null default 'marked' check (status in ('marked', 'confirmed', 'cancelled')),
  marked_at    timestamptz not null default now(),
  confirmed_at timestamptz,
  check (from_id <> to_id),
  foreign key (household_id, from_id) references public.members(household_id, user_id),
  foreign key (household_id, to_id) references public.members(household_id, user_id)
);

create table public.shares (
  purchase_id   uuid not null,
  household_id  uuid not null,
  debtor_id     uuid not null,
  amount        integer not null check (amount >= 0),
  settled_at    timestamptz,
  settlement_id uuid references public.settlements(id) on delete set null,
  primary key (purchase_id, debtor_id),
  foreign key (purchase_id, household_id) references public.purchases(id, household_id) on delete cascade,
  foreign key (household_id, debtor_id) references public.members(household_id, user_id)
);

create table public.bills (
  id                   uuid primary key default gen_random_uuid(),
  household_id         uuid not null references public.households(id) on delete cascade,
  title                text not null,
  icon                 text not null default 'receipt',
  amount               integer check (amount is null or amount > 0),
  variable             boolean not null default false,
  day_of_month         smallint not null check (day_of_month between 1 and 28),
  payer_id             uuid not null,
  last_generated_month text check (last_generated_month is null or last_generated_month ~ '^\d{4}-\d{2}$'),
  foreign key (household_id, payer_id) references public.members(household_id, user_id)
);

create table public.push_subscriptions (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  endpoint   text not null unique check (endpoint ~ '^https://'),
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);

create table public.capture_tokens (
  user_id      uuid not null references public.profiles(id) on delete cascade,
  -- generated and hashed server-side (slice 4); never readable by clients
  token_hash   text not null unique,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz
);

create table public.reminder_log (
  from_id uuid not null references public.profiles(id) on delete cascade,
  to_id   uuid not null references public.profiles(id) on delete cascade,
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- indexes on foreign keys

create index households_created_by_idx on public.households(created_by);
create index members_user_id_idx on public.members(user_id);
create index purchases_household_id_idx on public.purchases(household_id, created_at desc);
create index purchases_payer_idx on public.purchases(household_id, payer_id);
create index shares_debtor_idx on public.shares(household_id, debtor_id);
create index shares_settlement_id_idx on public.shares(settlement_id);
create index settlements_from_idx on public.settlements(household_id, from_id);
create index settlements_to_idx on public.settlements(household_id, to_id);
create index bills_payer_idx on public.bills(household_id, payer_id);
create index push_subscriptions_user_id_idx on public.push_subscriptions(user_id);
create index capture_tokens_user_id_idx on public.capture_tokens(user_id);
create index reminder_log_from_to_idx on public.reminder_log(from_id, to_id, sent_at desc);
create index reminder_log_to_id_idx on public.reminder_log(to_id);

-- ---------------------------------------------------------------- helpers (private schema)
-- security definer so policies on members do not recurse into themselves.
-- search_path is empty: every reference is schema-qualified.

create function private.is_member(household uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = household and m.user_id = auth.uid() and m.active
  );
$$;

create function private.is_admin(household uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.members m
    where m.household_id = household and m.user_id = auth.uid() and m.active and m.role = 'admin'
  );
$$;

create function private.shares_household_with(other uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.members a
    join public.members b on b.household_id = a.household_id and b.active
    where a.user_id = auth.uid() and a.active and b.user_id = other
  );
$$;

-- A purchase is visible to household members, except personal ones (payer only).
create function private.can_see_purchase(purchase uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchases p
    where p.id = purchase
      and private.is_member(p.household_id)
      and (p.status <> 'personal' or p.payer_id = auth.uid())
  );
$$;

-- The creator of a household becomes its first admin, in the same transaction.
create function private.add_creator_as_admin()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.members (household_id, user_id, role) values (new.id, new.created_by, 'admin');
  return new;
end;
$$;

-- L1: a household must always keep at least one active admin.
-- Hard-deleting the whole household (cascade) is still allowed.
create function private.guard_last_admin()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if old.role = 'admin' and old.active
     and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active)
     and exists (select 1 from public.households h where h.id = old.household_id)
     and not exists (
       select 1 from public.members m
       where m.household_id = old.household_id and m.user_id <> old.user_id and m.role = 'admin' and m.active
     )
  then
    raise exception 'a household must keep at least one active admin' using errcode = '23514';
  end if;
  return coalesce(new, old);
end;
$$;

create trigger households_add_creator after insert on public.households
  for each row execute function private.add_creator_as_admin();
create trigger members_guard_last_admin before update or delete on public.members
  for each row execute function private.guard_last_admin();

-- ---------------------------------------------------------------- RPCs (public, callable by clients)
-- Slice 1 adds join_household, leave_household, set_member_role, and the ledger writers.

create function public.create_household(household_name text)
returns public.households
language plpgsql security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  created public.households;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  insert into public.households (name, invite_code, created_by)
  values (btrim(household_name), substr(replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''), 1, 16), uid)
  returning * into created;
  return created;
end;
$$;

-- ---------------------------------------------------------------- grants
-- Start from nothing, then grant exactly what clients need.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
revoke all on schema public from anon;

grant usage on schema public to authenticated;
grant execute on function private.is_member(uuid), private.is_admin(uuid),
  private.shares_household_with(uuid), private.can_see_purchase(uuid) to authenticated;
grant execute on function public.create_household(text) to authenticated;

grant select on public.households, public.members, public.shares, public.settlements to authenticated;
grant select, insert, update (display_name, kaspi_phone, avatar_color) on public.profiles to authenticated;
grant update (name) on public.households to authenticated;
grant update (away_until) on public.members to authenticated;
grant select, insert, delete on public.purchases to authenticated;
grant update (description, merchant, status) on public.purchases to authenticated;
grant select, insert, update, delete on public.bills to authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
-- the token hash is never readable by clients
grant select (user_id, created_at, last_used_at), delete on public.capture_tokens to authenticated;
-- reminder_log: server / service role only (no grants)

-- ---------------------------------------------------------------- RLS

alter table public.profiles           enable row level security;
alter table public.households         enable row level security;
alter table public.members            enable row level security;
alter table public.purchases          enable row level security;
alter table public.shares             enable row level security;
alter table public.settlements        enable row level security;
alter table public.bills              enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.capture_tokens     enable row level security;
alter table public.reminder_log       enable row level security;

-- profiles: self + housemates readable; only self writable
create policy profiles_select on public.profiles for select to authenticated
  using (id = (select auth.uid()) or private.shares_household_with(id));
create policy profiles_insert on public.profiles for insert to authenticated
  with check (id = (select auth.uid()));
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- households: members read; admins rename. Create/delete only through RPCs.
create policy households_select on public.households for select to authenticated
  using (private.is_member(id));
create policy households_update on public.households for update to authenticated
  using (private.is_admin(id)) with check (private.is_admin(id));

-- members: housemates visible; a member may change only their own away_until
-- (column grant). Create/join/role/leave go through RPCs.
create policy members_select on public.members for select to authenticated
  using (private.is_member(household_id));
create policy members_update_self on public.members for update to authenticated
  using (user_id = (select auth.uid()) and active)
  with check (user_id = (select auth.uid()) and active);

-- purchases: personal ones only for the payer; clients write only their own
create policy purchases_select on public.purchases for select to authenticated
  using (private.is_member(household_id) and (status <> 'personal' or payer_id = (select auth.uid())));
create policy purchases_insert on public.purchases for insert to authenticated
  with check (private.is_member(household_id) and payer_id = (select auth.uid()));
create policy purchases_update on public.purchases for update to authenticated
  using (private.is_member(household_id) and payer_id = (select auth.uid()))
  with check (private.is_member(household_id) and payer_id = (select auth.uid()));
create policy purchases_delete on public.purchases for delete to authenticated
  using (private.is_member(household_id) and payer_id = (select auth.uid()));

-- shares and settlements: read-only for clients (writes via RPCs in slices 1 and 3)
create policy shares_select on public.shares for select to authenticated
  using (private.can_see_purchase(purchase_id));
create policy settlements_select on public.settlements for select to authenticated
  using (private.is_member(household_id));

create policy bills_all on public.bills for all to authenticated
  using (private.is_member(household_id)) with check (private.is_member(household_id));

-- owner-only tables
create policy push_subscriptions_owner on public.push_subscriptions for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy capture_tokens_owner on public.capture_tokens for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- reminder_log: RLS on, no policies, no grants => unreachable for clients
