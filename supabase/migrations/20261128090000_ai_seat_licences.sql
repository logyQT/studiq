-- ==========================================================
-- #1511 PR1: the sales-channel axis and the three AI seat licences.
--
-- An organization buys AI as a seat licence. A licence is a pool of N seats on
-- one AI tier, and the pool is an ordinary `subscription_plans` row with
-- `scope = 'personal'`, sold through a new sales channel. The pool itself is
-- still `org_seat_pools` (D15); no new entitlement key, no new resolver layer.
--
--   * `sales_channels text[]` says where a plan is sold. The set is closed by a
--     CHECK: `individual` (the existing personal and organization checkout) and
--     `seat_pool` (an organization seat licence).
--   * The three licence plans are `public` on purpose. A licence read has no
--     anonymous surface: `/pricing` and the plan detail filter to the
--     `individual` channel. An anonymous client can read the three rows, their
--     `ai.chat` entitlement row and their quota row — a price list, not a
--     secret (design §7.3).
--
-- This file owns the whole eleven-plan matrix, not only the three new rows.
-- `20261127090000_org_team_tier.sql` deletes every plan its eight-row matrix
-- does not list, so replaying that file alone would sweep the licences. One
-- owning file, replayed after it, ends on the eleven-plan matrix either way.
-- This file deletes no plan row: a B3 contract plan is created at runtime.
--
-- Prices are minor units (1999 = 19.99 zł). The tiers differ in AI quota only.
-- No `entitlement_catalog`, `entitlement_flags` or `limit_catalog` row is
-- written here: `ai.chat` and `max_ai_tokens_per_day` already exist.
-- ==========================================================

-- ==========================================================
-- 1. The channel column. `not null` plus a default means no backfill write and
--    no change to an existing row.
--
--    `cardinality` rejects `{}`; `array_length` answers NULL for an empty array
--    and a NULL CHECK passes, so it cannot close the set on its own.
-- ==========================================================
alter table public.subscription_plans
  add column if not exists sales_channels text[] not null default '{individual}';

alter table public.subscription_plans
  drop constraint if exists subscription_plans_sales_channels_check;
alter table public.subscription_plans
  add constraint subscription_plans_sales_channels_check
  check (
    cardinality(sales_channels) >= 1
    and sales_channels <@ array['individual', 'seat_pool']
  );

comment on column public.subscription_plans.sales_channels is
  'Where the plan is sold: individual = the plan and organization checkout, '
  'seat_pool = an organization seat licence. A new channel is one value here '
  'and one CHECK value, never a new column.';

-- ==========================================================
-- 2. The matrix (declarative source for every statement below).
--
-- The eight catalogue plans are re-asserted with `{individual}`. The three
-- licences are `{seat_pool}` only, and each carries exactly `ai.chat` with one
-- daily quota row. `sort_order` continues after `campus` (8).
-- ==========================================================
drop table if exists plan_catalog_plans;
create temp table plan_catalog_plans (
  plan_key      text primary key,
  name          text not null,
  price_monthly int not null,
  currency      text not null,
  sort_order    int not null,
  scope         text not null,
  visibility    text not null,
  billing_mode  text not null,
  sales_channels text[] not null
);

insert into plan_catalog_plans
  (plan_key, name, price_monthly, currency, sort_order, scope, visibility,
   billing_mode, sales_channels)
values
  ('free',    'StudiQ Free',      0,     'PLN', 1,  'personal',     'public', 'stripe', '{individual}'),
  ('plus',    'StudiQ Plus',      1999,  'PLN', 2,  'personal',     'public', 'stripe', '{individual}'),
  ('pro',     'StudiQ Pro',       3999,  'PLN', 3,  'personal',     'public', 'stripe', '{individual}'),
  ('max',     'StudiQ Max',       7999,  'PLN', 4,  'personal',     'public', 'stripe', '{individual}'),
  ('launch',  'StudiQ Launch',    0,     'PLN', 5,  'organization', 'public', 'stripe', '{individual}'),
  ('team',    'StudiQ Team',      9900,  'PLN', 6,  'organization', 'public', 'stripe', '{individual}'),
  ('hub',     'StudiQ Hub',       29900, 'PLN', 7,  'organization', 'public', 'stripe', '{individual}'),
  ('campus',  'StudiQ Campus',    69900, 'PLN', 8,  'organization', 'public', 'stripe', '{individual}'),
  ('ai_lite', 'StudiQ AI Lite',   1999,  'PLN', 9,  'personal',     'public', 'stripe', '{seat_pool}'),
  ('ai_pro',  'StudiQ AI Pro',    3999,  'PLN', 10, 'personal',     'public', 'stripe', '{seat_pool}'),
  ('ai_max',  'StudiQ AI Max',    7999,  'PLN', 11, 'personal',     'public', 'stripe', '{seat_pool}');

-- Each plan's entitlement set. A licence carries `ai.chat` only: the org
-- ceiling already grants content through the role profile, and the individual
-- ladder keeps `quiz.templates` / `stats.insights` to itself.
drop table if exists plan_catalog_entitlements;
create temp table plan_catalog_entitlements (
  plan_key        text not null,
  entitlement_key text not null,
  primary key (plan_key, entitlement_key)
);

insert into plan_catalog_entitlements (plan_key, entitlement_key) values
  ('free', 'flashcards'), ('free', 'quiz'),
  ('plus', 'flashcards'), ('plus', 'quiz'), ('plus', 'ai.chat'),
  ('plus', 'quiz.templates'),
  ('pro', 'flashcards'), ('pro', 'quiz'), ('pro', 'ai.chat'),
  ('pro', 'quiz.templates'), ('pro', 'stats.insights'),
  ('max', 'flashcards'), ('max', 'quiz'), ('max', 'ai.chat'),
  ('max', 'quiz.templates'), ('max', 'stats.insights'),
  ('launch', 'flashcards'), ('launch', 'quiz'),
  ('team', 'flashcards'), ('team', 'quiz'), ('team', 'quiz.templates'),
  ('hub', 'flashcards'), ('hub', 'quiz'), ('hub', 'quiz.templates'),
  ('hub', 'stats.insights'),
  ('campus', 'flashcards'), ('campus', 'quiz'), ('campus', 'quiz.templates'),
  ('campus', 'stats.insights'), ('campus', 'branding'),
  ('ai_lite', 'ai.chat'), ('ai_pro', 'ai.chat'), ('ai_max', 'ai.chat');

-- Each plan's limits. A licence carries one quota row: a missing row is 0, and
-- `max(org, seat, personal)` ignores it, so fourteen zero rows would be dead
-- weight (design §F6).
drop table if exists plan_catalog_limits;
create temp table plan_catalog_limits (
  plan_key    text not null,
  limit_key   text not null,
  limit_value int not null,
  primary key (plan_key, limit_key)
);

insert into plan_catalog_limits (plan_key, limit_key, limit_value) values
  ('free', 'max_flashcards', 100), ('free', 'max_questions', 50),
  ('free', 'max_decks', 10), ('free', 'max_question_banks', 5),
  ('free', 'max_quiz_attempts_per_day', 10), ('free', 'max_ai_tokens_per_day', 0),
  ('plus', 'max_flashcards', 1000), ('plus', 'max_questions', 500),
  ('plus', 'max_decks', 100), ('plus', 'max_question_banks', 50),
  ('plus', 'max_quiz_attempts_per_day', 50), ('plus', 'max_ai_tokens_per_day', 100000),
  ('pro', 'max_flashcards', 5000), ('pro', 'max_questions', 2000),
  ('pro', 'max_decks', 500), ('pro', 'max_question_banks', 200),
  ('pro', 'max_quiz_attempts_per_day', 100), ('pro', 'max_ai_tokens_per_day', 250000),
  ('max', 'max_flashcards', 25000), ('max', 'max_questions', 10000),
  ('max', 'max_decks', 2000), ('max', 'max_question_banks', 1000),
  ('max', 'max_quiz_attempts_per_day', 200), ('max', 'max_ai_tokens_per_day', 500000),
  ('launch', 'max_flashcards', 100), ('launch', 'max_questions', 50),
  ('launch', 'max_decks', 10), ('launch', 'max_question_banks', 5),
  ('launch', 'max_groups', 3), ('launch', 'max_students', 5),
  ('launch', 'max_quiz_attempts_per_day', 10),
  ('team', 'max_flashcards', 1000), ('team', 'max_questions', 500),
  ('team', 'max_decks', 100), ('team', 'max_question_banks', 50),
  ('team', 'max_groups', 10), ('team', 'max_students', 25),
  ('team', 'max_quiz_attempts_per_day', 50),
  ('hub', 'max_flashcards', 5000), ('hub', 'max_questions', 2500),
  ('hub', 'max_decks', 500), ('hub', 'max_question_banks', 200),
  ('hub', 'max_groups', 40), ('hub', 'max_students', 100),
  ('hub', 'max_quiz_attempts_per_day', -1),
  ('campus', 'max_flashcards', -1), ('campus', 'max_questions', -1),
  ('campus', 'max_decks', -1), ('campus', 'max_question_banks', -1),
  ('campus', 'max_groups', 100), ('campus', 'max_students', 1000),
  ('campus', 'max_quiz_attempts_per_day', -1),
  ('ai_lite', 'max_ai_tokens_per_day', 100000),
  ('ai_pro', 'max_ai_tokens_per_day', 300000),
  ('ai_max', 'max_ai_tokens_per_day', 1000000);

-- ==========================================================
-- 3. Plans. `is_active` and `description` stay runtime state: they are written
--    on insert and never overwritten for an existing plan.
-- ==========================================================
insert into public.subscription_plans
  (key, name, price_monthly, currency, sort_order, is_active, scope, visibility,
   billing_mode, sales_channels)
select plan_key, name, price_monthly, currency, sort_order, true, scope,
       visibility, billing_mode, sales_channels
from plan_catalog_plans
on conflict (key) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  currency = excluded.currency,
  sort_order = excluded.sort_order,
  scope = excluded.scope,
  visibility = excluded.visibility,
  billing_mode = excluded.billing_mode,
  sales_channels = excluded.sales_channels,
  updated_at = now();

-- ==========================================================
-- 4. Declarative children: remove rows the matrix does not list, then insert
--    the matrix. Only the eleven matrix plans are touched, so a runtime B3
--    contract plan keeps its own rows.
-- ==========================================================
delete from public.plan_entitlements pe
using plan_catalog_plans m
where pe.plan_key = m.plan_key
  and not exists (
    select 1 from plan_catalog_entitlements me
    where me.plan_key = pe.plan_key
      and me.entitlement_key = pe.entitlement_key
  );

insert into public.plan_entitlements (plan_key, entitlement_key)
select plan_key, entitlement_key from plan_catalog_entitlements
on conflict do nothing;

delete from public.plan_limits pl
using plan_catalog_plans m
where pl.plan_key = m.plan_key
  and not exists (
    select 1 from plan_catalog_limits ml
    where ml.plan_key = pl.plan_key
      and ml.limit_key = pl.limit_key
  );

insert into public.plan_limits (plan_key, limit_key, limit_value)
select plan_key, limit_key, limit_value from plan_catalog_limits
on conflict (plan_key, limit_key) do update set limit_value = excluded.limit_value;

-- ==========================================================
-- 5. An anonymous client reads the listed catalogue only. Re-asserted here
--    because the three licences are `public` and this file is the one that adds
--    them: the anon predicate must never widen with them. The definitions are
--    identical to `20261127160000_plan_anon_read_scope.sql`.
-- ==========================================================
drop policy if exists "Public pricing read" on public.subscription_plans;
drop policy if exists "Public listed pricing read" on public.subscription_plans;

create policy "Public pricing read" on public.subscription_plans
  for select to authenticated
  using (true);

create policy "Public listed pricing read" on public.subscription_plans
  for select to anon
  using (visibility = 'public' and is_active);

drop policy if exists "Public pricing read" on public.plan_entitlements;
drop policy if exists "Public listed pricing read" on public.plan_entitlements;

create policy "Public pricing read" on public.plan_entitlements
  for select to authenticated
  using (true);

create policy "Public listed pricing read" on public.plan_entitlements
  for select to anon
  using (
    exists (
      select 1
      from public.subscription_plans p
      where p.key = plan_entitlements.plan_key
        and p.visibility = 'public'
        and p.is_active
    )
  );

drop policy if exists "Public pricing read" on public.plan_limits;
drop policy if exists "Public listed pricing read" on public.plan_limits;

create policy "Public pricing read" on public.plan_limits
  for select to authenticated
  using (true);

create policy "Public listed pricing read" on public.plan_limits
  for select to anon
  using (
    exists (
      select 1
      from public.subscription_plans p
      where p.key = plan_limits.plan_key
        and p.visibility = 'public'
        and p.is_active
    )
  );

-- ==========================================================
-- 6. Closing guard (R26): assert the outcome against the literal matrix, not
--    against the tables this file just wrote. A second application leaves the
--    same matrix and passes the same guard.
-- ==========================================================
do $$
declare
  v_bad int;
  v_plan record;
  v_keys text[];
  v_limits jsonb;
begin
  -- The eleven matrix plans exist, whatever runtime contract plan also exists.
  select count(*) into v_bad
  from (values
    ('free'), ('plus'), ('pro'), ('max'),
    ('launch'), ('team'), ('hub'), ('campus'),
    ('ai_lite'), ('ai_pro'), ('ai_max')
  ) as expected(key)
  left join public.subscription_plans pl on pl.key = expected.key
  where pl.key is null;
  if v_bad <> 0 then
    raise exception 'guard: % matrix plan(s) are missing', v_bad
      using errcode = '23514';
  end if;

  -- Each plan carries the expected scope, price, order, visibility, billing
  -- mode and channel set. A digit typo fails here, not in the Stripe bootstrap.
  select count(*) into v_bad
  from (values
    ('free',    'personal',     0,     1,  'public', 'stripe', '{individual}'),
    ('plus',    'personal',     1999,  2,  'public', 'stripe', '{individual}'),
    ('pro',     'personal',     3999,  3,  'public', 'stripe', '{individual}'),
    ('max',     'personal',     7999,  4,  'public', 'stripe', '{individual}'),
    ('launch',  'organization', 0,     5,  'public', 'stripe', '{individual}'),
    ('team',    'organization', 9900,  6,  'public', 'stripe', '{individual}'),
    ('hub',     'organization', 29900, 7,  'public', 'stripe', '{individual}'),
    ('campus',  'organization', 69900, 8,  'public', 'stripe', '{individual}'),
    ('ai_lite', 'personal',     1999,  9,  'public', 'stripe', '{seat_pool}'),
    ('ai_pro',  'personal',     3999,  10, 'public', 'stripe', '{seat_pool}'),
    ('ai_max',  'personal',     7999,  11, 'public', 'stripe', '{seat_pool}')
  ) as expected(key, scope, price, sort_order, visibility, billing_mode, channels)
  left join public.subscription_plans pl on pl.key = expected.key
  where pl.key is null
     or pl.scope is distinct from expected.scope
     or pl.price_monthly is distinct from expected.price
     or pl.sort_order is distinct from expected.sort_order
     or pl.visibility is distinct from expected.visibility
     or pl.billing_mode is distinct from expected.billing_mode
     or pl.sales_channels is distinct from expected.channels::text[];
  if v_bad <> 0 then
    raise exception 'guard: % plan rows carry an unexpected catalogue value', v_bad
      using errcode = '23514';
  end if;

  -- A licence is a personal plan. An organization tier must never be a pool.
  select count(*) into v_bad
  from public.subscription_plans pl
  where 'seat_pool' = any (pl.sales_channels)
    and pl.scope <> 'personal';
  if v_bad <> 0 then
    raise exception 'guard: % non-personal plan(s) are sold as seat pools', v_bad
      using errcode = '23514';
  end if;

  -- Every plan's entitlement set is exactly the matrix.
  for v_plan in
    select * from (values
      ('free', array['flashcards', 'quiz']),
      ('plus', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates']),
      ('pro', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('max', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('launch', array['flashcards', 'quiz']),
      ('team', array['flashcards', 'quiz', 'quiz.templates']),
      ('hub', array['flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('campus', array['branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('ai_lite', array['ai.chat']),
      ('ai_pro', array['ai.chat']),
      ('ai_max', array['ai.chat'])
    ) as m(key, expected_keys)
  loop
    select coalesce(array_agg(entitlement_key order by entitlement_key), '{}'::text[])
      into v_keys
      from public.plan_entitlements
      where plan_key = v_plan.key;
    if v_keys <> v_plan.expected_keys then
      raise exception 'guard: % carries entitlements %, expected %',
        v_plan.key, v_keys, v_plan.expected_keys
        using errcode = '23514';
    end if;
  end loop;

  -- Every plan's limit set is exactly the matrix, values included.
  for v_plan in
    select * from (values
      ('free', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0}'::jsonb),
      ('plus', '{"max_flashcards":1000,"max_questions":500,"max_decks":100,"max_question_banks":50,"max_quiz_attempts_per_day":50,"max_ai_tokens_per_day":100000}'::jsonb),
      ('pro', '{"max_flashcards":5000,"max_questions":2000,"max_decks":500,"max_question_banks":200,"max_quiz_attempts_per_day":100,"max_ai_tokens_per_day":250000}'::jsonb),
      ('max', '{"max_flashcards":25000,"max_questions":10000,"max_decks":2000,"max_question_banks":1000,"max_quiz_attempts_per_day":200,"max_ai_tokens_per_day":500000}'::jsonb),
      ('launch', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_groups":3,"max_students":5,"max_quiz_attempts_per_day":10}'::jsonb),
      ('team', '{"max_flashcards":1000,"max_questions":500,"max_decks":100,"max_question_banks":50,"max_groups":10,"max_students":25,"max_quiz_attempts_per_day":50}'::jsonb),
      ('hub', '{"max_flashcards":5000,"max_questions":2500,"max_decks":500,"max_question_banks":200,"max_groups":40,"max_students":100,"max_quiz_attempts_per_day":-1}'::jsonb),
      ('campus', '{"max_flashcards":-1,"max_questions":-1,"max_decks":-1,"max_question_banks":-1,"max_groups":100,"max_students":1000,"max_quiz_attempts_per_day":-1}'::jsonb),
      ('ai_lite', '{"max_ai_tokens_per_day":100000}'::jsonb),
      ('ai_pro', '{"max_ai_tokens_per_day":300000}'::jsonb),
      ('ai_max', '{"max_ai_tokens_per_day":1000000}'::jsonb)
    ) as m(key, expected_limits)
  loop
    select coalesce(jsonb_object_agg(limit_key, limit_value), '{}'::jsonb)
      into v_limits
      from public.plan_limits
      where plan_key = v_plan.key;
    if v_limits <> v_plan.expected_limits then
      raise exception 'guard: % carries limits %, expected %',
        v_plan.key, v_limits, v_plan.expected_limits
        using errcode = '23514';
    end if;
  end loop;

  -- No organization plan carries AI: the licence is the only AI purchase.
  select count(*) into v_bad
  from public.plan_entitlements pe
  join public.subscription_plans p on p.key = pe.plan_key
  where p.scope = 'organization'
    and pe.entitlement_key = 'ai.chat';
  if v_bad <> 0 then
    raise exception 'guard: % organization plan(s) carry ai.chat', v_bad
      using errcode = '23514';
  end if;

  -- A seat may carry only a personal key (§6.1 invariant, D38).
  select count(*) into v_bad
  from public.plan_entitlements pe
  join public.subscription_plans p on p.key = pe.plan_key
  join public.entitlement_catalog c on c.key = pe.entitlement_key
  where 'seat_pool' = any (p.sales_channels)
    and c.scope <> 'personal';
  if v_bad <> 0 then
    raise exception 'guard: % seat licence entr(y/ies) are not personal scope', v_bad
      using errcode = '23514';
  end if;

  -- `ai.chat` stays the seat-eligible surface entitlement the licences sell.
  select count(*) into v_bad
  from public.entitlement_catalog
  where key = 'ai.chat' and seat_eligible;
  if v_bad <> 1 then
    raise exception 'guard: ai.chat is not seat_eligible in entitlement_catalog'
      using errcode = '23514';
  end if;

  -- The channel set is closed by a CHECK, and the column is not nullable.
  select count(*) into v_bad
  from pg_constraint
  where conrelid = 'public.subscription_plans'::regclass
    and conname = 'subscription_plans_sales_channels_check'
    and contype = 'c';
  if v_bad <> 1 then
    raise exception 'guard: subscription_plans has no sales_channels CHECK'
      using errcode = '23514';
  end if;

  -- One pool per (organization, plan) is still the licence uniqueness rule.
  select count(*) into v_bad
  from pg_constraint
  where conrelid = 'public.org_seat_pools'::regclass
    and contype = 'u'
    and pg_get_constraintdef(oid) like '%(organization_id, plan_key)%';
  if v_bad <> 1 then
    raise exception 'guard: org_seat_pools lost its (organization_id, plan_key) unique key'
      using errcode = '23514';
  end if;

  -- The anonymous read still filters on visibility and is_active, one policy per
  -- pricing table.
  for v_plan in
    select * from (values
      ('subscription_plans'), ('plan_entitlements'), ('plan_limits')
    ) as pricing(tablename)
  loop
    select count(*) into v_bad
    from pg_policies
    where schemaname = 'public'
      and tablename = v_plan.tablename
      and cmd = 'SELECT'
      and roles @> array['anon']::name[]
      and qual is not null
      and position('visibility' in qual) > 0
      and position('is_active' in qual) > 0;
    if v_bad <> 1 then
      raise exception 'guard: % has % anon policy/policies with visibility/is_active (expected 1)',
        v_plan.tablename, v_bad
        using errcode = '42501';
    end if;
  end loop;
end $$;

drop table if exists plan_catalog_plans;
drop table if exists plan_catalog_entitlements;
drop table if exists plan_catalog_limits;
