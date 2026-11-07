-- 0004_slice4_capture: Apple Pay capture (SDD §6.2, §9). 0001-0003 are LIVE and untouched; this file only adds.
--
-- The capture endpoint runs with the ANON key and NO service-role key. The only way in for `anon` is
--   capture_purchase(token, amount, merchant)   authenticates the caller by sha256(token), stores a PENDING purchase
--   prune_push_subscription(token, endpoint)    removes a dead push endpoint of the token's owner
-- Both are security definer, `search_path = ''`, and raise the same generic 28000 for an unknown token.
-- `anon` still has no privilege on any table.
--
--   rotate_capture_token()          authenticated; 32 random bytes (base64url), only the sha256 hex hash is stored, plaintext returned once
--   resolve_pending(id, shared, description, participants)   payer only, only while pending
--   set_default_household(id)       member only
--   save_push_subscription(endpoint, p256dh, auth)   upsert by endpoint (a device can change owner); allowlisted hosts, 10 per user
--
-- Pending purchases are visible ONLY to their payer (like personal ones): can_see_purchase and purchases_select are replaced.
-- The equal-split rule now lives in two private helpers shared by create_purchase_with_shares (replaced, same behaviour)
-- and resolve_pending.
--
-- Error codes: 28000 invalid token / not signed in, P0001 rate_limited (30 captures per user per hour),
-- 23514 invalid input / no_household / already_resolved, 42501 not a member, P0002 purchase not found (or not yours).

-- ---------------------------------------------------------------- pgcrypto (Supabase keeps it in `extensions`)

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------- default household

alter table public.profiles
  add column default_household_id uuid references public.households(id) on delete set null;

-- ---------------------------------------------------------------- push endpoint allowlist (S1) and one token per user (S3)

-- A push endpoint is fetched by OUR server with a VAPID JWT, so it must be a real push service, never an arbitrary URL.
-- Existing rows (if any) that break the rule are removed first so the constraint can be validated.
delete from public.push_subscriptions
where endpoint !~* '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/';
alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_allowlist
  check (endpoint ~* '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/') not valid;
alter table public.push_subscriptions validate constraint push_subscriptions_endpoint_allowlist;

-- Clients may only read and delete their rows; every write goes through save_push_subscription (host check + cap).
revoke insert, update on public.push_subscriptions from authenticated;

delete from public.capture_tokens t
where exists (select 1 from public.capture_tokens o where o.user_id = t.user_id and o.created_at > t.created_at);
create unique index capture_tokens_user_id_key on public.capture_tokens (user_id);

-- ---------------------------------------------------------------- visibility: pending and personal are payer-only

create or replace function private.can_see_purchase(purchase uuid)
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.purchases p
    where p.id = purchase
      and private.is_member(p.household_id)
      and (p.status = 'shared' or p.payer_id = auth.uid())
  );
$$;

drop policy purchases_select on public.purchases;
create policy purchases_select on public.purchases for select to authenticated
  using (private.is_member(household_id) and (status = 'shared' or payer_id = (select auth.uid())));

-- ---------------------------------------------------------------- rate limit (private, no client access)

create table private.capture_ops (
  id      bigint generated always as identity primary key,
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index capture_ops_user_at_idx on private.capture_ops (user_id, at desc);
alter table private.capture_ops enable row level security;
revoke all on table private.capture_ops from public, anon, authenticated;

-- ---------------------------------------------------------------- split helpers (shared by create and resolve)

-- Participant rules of 0002: 1..50 distinct active members, and every one of them owes at least 1 tenge.
create function private.check_participants(p_household_id uuid, p_amount integer, p_participant_ids uuid[])
returns void
language plpgsql stable security definer
set search_path = ''
as $$
declare
  v_n integer := coalesce(cardinality(p_participant_ids), 0);
begin
  if v_n < 1 or v_n > 50 then
    raise exception 'between 1 and 50 participants' using errcode = '23514';
  end if;
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
end;
$$;
revoke all on function private.check_participants(uuid, integer, uuid[]) from public, anon, authenticated;

-- Same rule as src/lib/domain/split.ts (splitEqual): base = floor(amount / N); the remainder goes 1 tenge at a time to
-- NON-payers in participant order; the payer's own share is settled at once.
create function private.insert_equal_shares(
  p_purchase_id uuid, p_household_id uuid, p_payer uuid, p_amount integer, p_participant_ids uuid[]
)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_n integer := cardinality(p_participant_ids);
  v_base integer := p_amount / cardinality(p_participant_ids);
  v_rem integer := p_amount - (p_amount / cardinality(p_participant_ids)) * cardinality(p_participant_ids);
begin
  insert into public.shares (purchase_id, household_id, debtor_id, amount, settled_at)
  select
    p_purchase_id, p_household_id, t.pid,
    v_base + case when t.pid <> p_payer and t.non_payer_rank <= v_rem then 1 else 0 end,
    case when t.pid = p_payer then now() end
  from (
    select u.pid, u.ord, count(*) filter (where u.pid <> p_payer) over (order by u.ord) as non_payer_rank
    from unnest(p_participant_ids) with ordinality as u(pid, ord)
  ) t;
end;
$$;
revoke all on function private.insert_equal_shares(uuid, uuid, uuid, integer, uuid[]) from public, anon, authenticated;

create function private.purchase_json(p_purchase_id uuid)
returns jsonb
language sql stable security definer
set search_path = ''
as $$
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
  from public.purchases p
  where p.id = p_purchase_id;
$$;
revoke all on function private.purchase_json(uuid) from public, anon, authenticated;

-- 0002's function, same behaviour, now built on the helpers (create or replace keeps its grants).
create or replace function public.create_purchase_with_shares(
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
  v_id uuid;
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
  perform private.check_participants(p_household_id, p_amount, p_participant_ids);

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status)
  values (p_household_id, v_uid, p_amount, v_desc, v_merchant, 'manual', 'shared')
  returning id into v_id;

  perform private.insert_equal_shares(v_id, p_household_id, v_uid, p_amount, p_participant_ids);
  return private.purchase_json(v_id);
end;
$$;

-- ---------------------------------------------------------------- rotate_capture_token

create function public.rotate_capture_token()
returns text
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_token text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  -- 32 random bytes -> 43 base64url characters
  v_token := rtrim(translate(encode(extensions.gen_random_bytes(32), 'base64'), '+/', '-_'), '=');
  delete from public.capture_tokens t where t.user_id = v_uid;
  insert into public.capture_tokens (user_id, token_hash)
  values (v_uid, encode(extensions.digest(v_token, 'sha256'), 'hex'));
  return v_token;
end;
$$;

-- ---------------------------------------------------------------- capture_purchase (anon + authenticated)

create function public.capture_purchase(p_token text, p_amount integer, p_merchant text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_uid uuid;
  v_hh uuid;
  -- strip C0/C1 control characters and bidi overrides/isolates/marks before anything is stored or pushed
  v_merchant text := nullif(btrim(regexp_replace(coalesce(p_merchant, ''), '[\x01-\x1f\x7f-\x9f\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', 'g')), '');
  v_id uuid;
  v_subs jsonb;
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

  -- a Shortcut retry (same amount and merchant within 60 s) returns the existing pending purchase, without a second push
  select p.id into v_id from public.purchases p
  where p.payer_id = v_uid and p.source = 'apple_pay' and p.status = 'pending' and p.amount = p_amount
    and p.merchant is not distinct from v_merchant and p.created_at > now() - interval '60 seconds'
  order by p.created_at desc limit 1;
  if v_id is not null then
    return jsonb_build_object(
      'purchase_id', v_id, 'household_id', v_hh, 'amount', p_amount, 'merchant', v_merchant,
      'subscriptions', '[]'::jsonb, 'deduped', true
    );
  end if;

  insert into private.capture_ops (user_id) values (v_uid);
  update public.capture_tokens t set last_used_at = now() where t.token_hash = v_hash;

  insert into public.purchases (household_id, payer_id, amount, description, merchant, source, status)
  values (v_hh, v_uid, p_amount, coalesce(v_merchant, 'Покупка'), v_merchant, 'apple_pay', 'pending')
  returning id into v_id;

  select coalesce(jsonb_agg(jsonb_build_object('endpoint', s.endpoint, 'p256dh', s.p256dh, 'auth', s.auth)), '[]'::jsonb)
  into v_subs
  from public.push_subscriptions s
  where s.user_id = v_uid;

  return jsonb_build_object(
    'purchase_id', v_id, 'household_id', v_hh, 'amount', p_amount, 'merchant', v_merchant, 'subscriptions', v_subs
  );
end;
$$;

-- ---------------------------------------------------------------- prune_push_subscription (token-authenticated)

create function public.prune_push_subscription(p_token text, p_endpoint text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid;
begin
  if p_token is null or char_length(p_token) not between 20 and 200 then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  select t.user_id into v_uid
  from public.capture_tokens t
  where t.token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if v_uid is null then
    raise exception 'invalid token' using errcode = '28000';
  end if;
  delete from public.push_subscriptions s where s.user_id = v_uid and s.endpoint = p_endpoint;
end;
$$;

-- ---------------------------------------------------------------- resolve_pending

create function public.resolve_pending(
  p_purchase_id uuid,
  p_shared boolean,
  p_description text,
  p_participant_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_p public.purchases;
  v_desc text;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_shared is null then
    raise exception 'shared flag is required' using errcode = '23514';
  end if;

  select * into v_p from public.purchases p where p.id = p_purchase_id for update;
  -- not found and not yours look the same
  if not found or v_p.payer_id <> v_uid or not private.is_member(v_p.household_id) then
    raise exception 'purchase not found' using errcode = 'P0002';
  end if;

  if v_p.status <> 'pending' then
    -- idempotent per final state: asking for the state it already has changes nothing
    if (v_p.status = 'shared') = p_shared then
      return private.purchase_json(v_p.id);
    end if;
    raise exception 'already_resolved' using errcode = '23514';
  end if;

  v_desc := coalesce(nullif(btrim(coalesce(p_description, '')), ''), v_p.description);
  if char_length(v_desc) not between 1 and 200 then
    raise exception 'invalid description' using errcode = '23514';
  end if;

  if p_shared then
    perform private.check_participants(v_p.household_id, v_p.amount, p_participant_ids);
    update public.purchases p set description = v_desc, status = 'shared' where p.id = v_p.id;
    perform private.insert_equal_shares(v_p.id, v_p.household_id, v_uid, v_p.amount, p_participant_ids);
  else
    update public.purchases p set description = v_desc, status = 'personal' where p.id = v_p.id;
  end if;
  return private.purchase_json(v_p.id);
end;
$$;

-- ---------------------------------------------------------------- set_default_household, save_push_subscription

create function public.set_default_household(p_household_id uuid)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not private.is_member(p_household_id) then
    raise exception 'not a member of this household' using errcode = '42501';
  end if;
  update public.profiles p set default_household_id = p_household_id where p.id = v_uid;
  if not found then
    raise exception 'profile_required' using errcode = 'P0001';
  end if;
end;
$$;

create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void
language plpgsql security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_endpoint is null or char_length(p_endpoint) > 2048
     or p_endpoint !~* '^https://(web\.push\.apple\.com|fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|[a-z0-9-]+\.notify\.windows\.com)/'
     or coalesce(char_length(p_p256dh), 0) not between 1 and 256 or coalesce(char_length(p_auth), 0) not between 1 and 256 then
    raise exception 'invalid subscription' using errcode = '23514';
  end if;
  -- S2: the same device may sign in as another user, so an existing endpoint MOVES to the caller. The previous owner's
  -- row is gone by design (the app also deletes it on sign-out); a push endpoint is an unguessable per-device URL.
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values (v_uid, p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
    created_at = now();
  -- cap: at most 10 per user, the oldest are dropped
  delete from public.push_subscriptions s
  where s.user_id = v_uid and s.endpoint in (
    select o.endpoint from public.push_subscriptions o where o.user_id = v_uid
    order by o.created_at desc, o.endpoint offset 10
  );
end;
$$;

-- ---------------------------------------------------------------- grants

revoke all on function public.rotate_capture_token() from public, anon, authenticated;
revoke all on function public.capture_purchase(text, integer, text) from public, anon, authenticated;
revoke all on function public.prune_push_subscription(text, text) from public, anon, authenticated;
revoke all on function public.resolve_pending(uuid, boolean, text, uuid[]) from public, anon, authenticated;
revoke all on function public.set_default_household(uuid) from public, anon, authenticated;
revoke all on function public.save_push_subscription(text, text, text) from public, anon, authenticated;

-- PostgREST needs schema usage to reach the two anon-callable functions; anon still has no table privilege.
grant usage on schema public to anon;
grant execute on function public.capture_purchase(text, integer, text) to anon;
grant execute on function public.prune_push_subscription(text, text) to anon, authenticated;
grant execute on function public.rotate_capture_token() to authenticated;
grant execute on function public.resolve_pending(uuid, boolean, text, uuid[]) to authenticated;
grant execute on function public.set_default_household(uuid) to authenticated;
grant execute on function public.save_push_subscription(text, text, text) to authenticated;
