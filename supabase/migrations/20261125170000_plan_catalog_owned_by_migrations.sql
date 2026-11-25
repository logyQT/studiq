-- ==========================================================
-- #1494: the plan catalogue is migration-owned code.
--
-- Before this file the catalogue had two homes: this migration chain (which
-- inserts no plan rows at all) and `supabase/seeds/00_plans.sql`, which
-- DELETEd and re-inserted every plan, entitlement and limit row. `db reset`
-- and CI therefore read one matrix from the seed while production (`db push`,
-- which never runs seeds) had no reproducible catalogue — and a plan row added
-- by a migration was silently wiped on the next reset.
--
-- This file is now the single home. It is declarative, not additive: the
-- matrix below is the whole truth for the thirteen catalogue plans, so a key
-- removed from it is deleted from the database, and an entitlement/limit row
-- the matrix does not list is deleted too. Applying the file twice leaves the
-- same matrix.
--
-- The catalogue is code, not data an operator edits:
--   * an admin-panel price/key/entitlement edit is a dev-only experiment that
--     the next migration re-asserts;
--   * `is_active` (kill switch) and `description` (admin-only text) are
--     runtime state — inserted as `true`/NULL for a new plan, never overwritten
--     for an existing one;
--   * a `price_monthly` change also needs the test-mode Stripe bootstrap
--     re-run (`bun scripts/stripe-bootstrap.ts`) so the `stripe_prices` mapping
--     rotates with it. Stripe-mode checkout fails closed while the catalogue
--     and the mapped Price disagree.
--
-- The approved flat monthly PLN ladder (#662, operator 2026-11-04):
--   student  Spark 9.99 · Ace 19.99 · Pro 39.99
--   educator Guide 19.99 · Creator 39.99 · Master 79.99
--   org      Team 99 · Hub 299 · Campus 699
--   manager  Solo 0 (the free personal plan; ADR-0015 D2 — `launch` is
--            organization-only since phase 4a)
-- `scope`/`audience` replace `for_account_type` (ADR-0015 phase 4a, D32):
-- organization plans carry no audience, personal plans always do.
-- ==========================================================

-- ==========================================================
-- 1. Column defaults (idempotent by nature). Before this file the defaults
--    were re-applied by the seed on every reset, so `db push` alone left
--    `profiles.personal_plan_key` defaulting to the legacy `free` plan.
-- ==========================================================
alter table public.profiles alter column personal_plan_key set default 'base';
alter table public.organizations alter column plan set default 'launch';

-- ==========================================================
-- 2. Flag rows the catalogue depends on. Insert-if-missing only: a flag row is
--    the kill switch (D8), so `is_enabled` is runtime state and is never
--    forced here. A surface key with no flag row fails closed in the resolver.
-- ==========================================================
insert into public.entitlement_flags (key, name, description) values
  ('branding', 'Custom Branding', 'Organization logo and brand color across the app'),
  ('quiz.templates', 'Saved quiz library', 'Save quizzes and reuse them across assignments'),
  ('stats.insights', 'Insights & weak points', 'Weak points, retention and class-activity diagnostics')
on conflict (key) do nothing;

-- ==========================================================
-- 3. The matrix (declarative source for every statement below).
-- ==========================================================
drop table if exists plan_catalog_plans;
create temp table plan_catalog_plans (
  plan_key      text primary key,
  name          text not null,
  price_monthly int not null,
  currency      text not null,
  sort_order    int not null,
  scope         text not null,
  audience      text
);

insert into plan_catalog_plans
  (plan_key, name, price_monthly, currency, sort_order, scope, audience)
values
  ('base',    'StudiQ Base',    0,     'PLN', 1,  'personal',     'student'),
  ('lite',    'StudiQ Lite',    0,     'PLN', 2,  'personal',     'educator'),
  ('launch',  'StudiQ Launch',  0,     'PLN', 3,  'organization', null),
  ('spark',   'StudiQ Spark',   999,   'PLN', 4,  'personal',     'student'),
  ('guide',   'StudiQ Guide',   1999,  'PLN', 5,  'personal',     'educator'),
  ('team',    'StudiQ Team',    9900,  'PLN', 6,  'organization', null),
  ('ace',     'StudiQ Ace',     1999,  'PLN', 7,  'personal',     'student'),
  ('creator', 'StudiQ Creator', 3999,  'PLN', 8,  'personal',     'educator'),
  ('hub',     'StudiQ Hub',     29900, 'PLN', 9,  'organization', null),
  ('pro',     'StudiQ Pro',     3999,  'PLN', 10, 'personal',     'student'),
  ('master',  'StudiQ Master',  7999,  'PLN', 11, 'personal',     'educator'),
  ('campus',  'StudiQ Campus',  69900, 'PLN', 12, 'organization', null),
  ('solo',    'StudiQ Solo',    0,     'PLN', 13, 'personal',     'manager');

-- Each plan's entitlement set. The free tiers carry the baseline keys only;
-- `quiz.templates`, `stats.insights` and `branding` are the paid surfaces.
drop table if exists plan_catalog_entitlements;
create temp table plan_catalog_entitlements (
  plan_key        text not null,
  entitlement_key text not null,
  primary key (plan_key, entitlement_key)
);

insert into plan_catalog_entitlements (plan_key, entitlement_key) values
  ('base', 'flashcards'), ('base', 'quiz'),
  ('lite', 'flashcards'), ('lite', 'quiz'),
  ('launch', 'flashcards'), ('launch', 'quiz'),
  ('solo', 'flashcards'), ('solo', 'quiz'),
  ('spark', 'flashcards'), ('spark', 'quiz'),
  ('guide', 'flashcards'), ('guide', 'quiz'), ('guide', 'quiz.templates'),
  ('team', 'flashcards'), ('team', 'quiz'), ('team', 'quiz.templates'),
  ('ace', 'flashcards'), ('ace', 'quiz'), ('ace', 'ai.chat'), ('ace', 'stats.insights'),
  ('creator', 'flashcards'), ('creator', 'quiz'), ('creator', 'ai.chat'),
  ('creator', 'quiz.templates'), ('creator', 'stats.insights'),
  ('hub', 'flashcards'), ('hub', 'quiz'), ('hub', 'ai.chat'),
  ('hub', 'quiz.templates'), ('hub', 'stats.insights'), ('hub', 'branding'),
  ('pro', 'flashcards'), ('pro', 'quiz'), ('pro', 'ai.chat'), ('pro', 'stats.insights'),
  ('master', 'flashcards'), ('master', 'quiz'), ('master', 'ai.chat'),
  ('master', 'quiz.templates'), ('master', 'stats.insights'),
  ('campus', 'flashcards'), ('campus', 'quiz'), ('campus', 'ai.chat'),
  ('campus', 'quiz.templates'), ('campus', 'stats.insights'), ('campus', 'branding');

-- Each plan's limits. A missing `plan_limits` row resolves to 0 (blocked),
-- never to "free", so every plan spells out every key its audience uses.
-- `-1` = unlimited.
drop table if exists plan_catalog_limits;
create temp table plan_catalog_limits (
  plan_key    text not null,
  limit_key   text not null,
  limit_value int not null,
  primary key (plan_key, limit_key)
);

insert into plan_catalog_limits (plan_key, limit_key, limit_value) values
  -- Free tier
  ('base', 'max_flashcards', 100), ('base', 'max_questions', 50),
  ('base', 'max_decks', 10), ('base', 'max_question_banks', 5),
  ('base', 'max_quiz_attempts_per_day', 10), ('base', 'max_ai_tokens_per_day', 0),
  ('base', 'max_students', -1), ('base', 'max_groups', -1),
  ('lite', 'max_flashcards', 100), ('lite', 'max_questions', 50),
  ('lite', 'max_decks', 10), ('lite', 'max_question_banks', 5),
  ('lite', 'max_groups', 1), ('lite', 'max_students', 5),
  ('lite', 'max_quiz_attempts_per_day', 10), ('lite', 'max_ai_tokens_per_day', 0),
  ('launch', 'max_flashcards', 100), ('launch', 'max_questions', 50),
  ('launch', 'max_decks', 10), ('launch', 'max_question_banks', 5),
  ('launch', 'max_groups', 3), ('launch', 'max_students', 5),
  ('launch', 'max_quiz_attempts_per_day', 10), ('launch', 'max_ai_tokens_per_day', 0),
  -- `solo` mirrors `base`: a seat pool may carry it and the free manager plan
  -- is baseline-only (ADR-0015 D2, phase 4a).
  ('solo', 'max_flashcards', 100), ('solo', 'max_questions', 50),
  ('solo', 'max_decks', 10), ('solo', 'max_question_banks', 5),
  ('solo', 'max_quiz_attempts_per_day', 10), ('solo', 'max_ai_tokens_per_day', 0),
  ('solo', 'max_students', -1), ('solo', 'max_groups', -1),
  -- Basic tier
  ('spark', 'max_flashcards', 500), ('spark', 'max_questions', 200),
  ('spark', 'max_decks', 50), ('spark', 'max_question_banks', 20),
  ('spark', 'max_quiz_attempts_per_day', 50), ('spark', 'max_ai_tokens_per_day', 0),
  ('guide', 'max_flashcards', 500), ('guide', 'max_questions', 200),
  ('guide', 'max_decks', 50), ('guide', 'max_question_banks', 20),
  ('guide', 'max_groups', 5), ('guide', 'max_students', 5),
  ('guide', 'max_quiz_attempts_per_day', 50), ('guide', 'max_ai_tokens_per_day', 0),
  ('team', 'max_flashcards', 500), ('team', 'max_questions', 200),
  ('team', 'max_decks', 50), ('team', 'max_question_banks', 20),
  ('team', 'max_groups', 5), ('team', 'max_students', 5),
  ('team', 'max_quiz_attempts_per_day', 50), ('team', 'max_ai_tokens_per_day', 0),
  -- Premium tier
  ('ace', 'max_flashcards', 2000), ('ace', 'max_questions', 1000),
  ('ace', 'max_decks', 200), ('ace', 'max_question_banks', 100),
  ('ace', 'max_quiz_attempts_per_day', -1), ('ace', 'max_ai_tokens_per_day', 200000),
  ('creator', 'max_flashcards', 2000), ('creator', 'max_questions', 1000),
  ('creator', 'max_decks', 200), ('creator', 'max_question_banks', 100),
  ('creator', 'max_groups', 20), ('creator', 'max_students', 50),
  ('creator', 'max_quiz_attempts_per_day', -1), ('creator', 'max_ai_tokens_per_day', 200000),
  ('hub', 'max_flashcards', 2000), ('hub', 'max_questions', 1000),
  ('hub', 'max_decks', 200), ('hub', 'max_question_banks', 100),
  ('hub', 'max_groups', 20), ('hub', 'max_students', 50),
  ('hub', 'max_quiz_attempts_per_day', -1), ('hub', 'max_ai_tokens_per_day', 200000),
  -- Advanced tier
  ('pro', 'max_flashcards', -1), ('pro', 'max_questions', -1),
  ('pro', 'max_decks', -1), ('pro', 'max_question_banks', -1),
  ('pro', 'max_quiz_attempts_per_day', -1), ('pro', 'max_ai_tokens_per_day', -1),
  ('master', 'max_flashcards', -1), ('master', 'max_questions', -1),
  ('master', 'max_decks', -1), ('master', 'max_question_banks', -1),
  ('master', 'max_groups', -1), ('master', 'max_students', -1),
  ('master', 'max_quiz_attempts_per_day', -1), ('master', 'max_ai_tokens_per_day', -1),
  ('campus', 'max_flashcards', -1), ('campus', 'max_questions', -1),
  ('campus', 'max_decks', -1), ('campus', 'max_question_banks', -1),
  ('campus', 'max_groups', -1), ('campus', 'max_students', -1),
  ('campus', 'max_quiz_attempts_per_day', -1), ('campus', 'max_ai_tokens_per_day', -1);

-- ==========================================================
-- 4. Plans. `is_active` and `description` are deliberately absent from the
--    conflict update: they are runtime state, not catalogue code.
-- ==========================================================
insert into public.subscription_plans
  (key, name, price_monthly, currency, sort_order, is_active, scope, audience)
select plan_key, name, price_monthly, currency, sort_order, true, scope, audience
from plan_catalog_plans
on conflict (key) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  currency = excluded.currency,
  sort_order = excluded.sort_order,
  scope = excluded.scope,
  audience = excluded.audience,
  updated_at = now();

-- ==========================================================
-- 5. Every plan outside the matrix is retired. Rows that point at a retired
--    plan are re-pointed at the free plan of the same shape first (the same
--    treatment `20260924000002` gave the legacy `sysadmin` plan); a seat pool
--    is a paid licence, so it aborts with a readable message instead of being
--    silently deleted.
-- ==========================================================
update public.profiles p
set personal_plan_key = case p.account_type
  when 'educator' then 'lite'
  when 'manager' then 'solo'
  else 'base'
end
where not exists (select 1 from plan_catalog_plans m where m.plan_key = p.personal_plan_key);

-- An organization on a retired plan moves to `launch` silently otherwise: a
-- paying `school`/`premium` org would lose its limits with nothing in the
-- `db push` output. Report the count and the keys instead of aborting — the
-- seat-pool check below already refuses a paid licence.
do $$
declare
  v_rows int;
  v_keys text;
begin
  select string_agg(distinct o.plan, ', ' order by o.plan)
    into v_keys
  from public.organizations o
  where not exists (select 1 from plan_catalog_plans m where m.plan_key = o.plan);

  update public.organizations o
  set plan = 'launch'
  where not exists (select 1 from plan_catalog_plans m where m.plan_key = o.plan);
  get diagnostics v_rows = row_count;

  if v_rows > 0 then
    raise notice
      'plan catalogue: re-pointed % organization(s) from retired plan(s) [%] to launch — check their limits',
      v_rows, v_keys;
  end if;
end $$;

do $$
declare
  bad record;
begin
  for bad in
    select sp.id as pool_id, sp.plan_key
    from public.org_seat_pools sp
    where not exists (select 1 from plan_catalog_plans m where m.plan_key = sp.plan_key)
  loop
    raise exception
      'org_seat_pools.% points at retired plan % — re-point or remove the pool before this migration',
      bad.pool_id, bad.plan_key
      using errcode = '23503';
  end loop;
end $$;

delete from public.subscription_plans pl
where not exists (select 1 from plan_catalog_plans m where m.plan_key = pl.key);

-- ==========================================================
-- 6. Declarative children: remove rows the matrix does not list, then insert
--    the matrix. (The plan delete above already cascaded the retired plans'
--    rows; this handles a row added by hand to a matrix plan.)
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
-- 7. Closing guard (R26): assert the outcome against the literal matrix, not
--    against the tables this file just wrote. A re-run leaves the same counts,
--    so the same guard passes on a second application.
-- ==========================================================
do $$
declare
  v_plan_count int;
  v_bad int;
  v_plan record;
  v_keys text[];
  v_limits jsonb;
begin
  -- Exactly the thirteen catalogue plans …
  select count(*) into v_plan_count from public.subscription_plans;
  if v_plan_count <> 13 then
    raise exception 'guard: % subscription_plans rows (expected 13)', v_plan_count
      using errcode = '23514';
  end if;

  -- … with the expected scope/audience pair and price. `price_monthly` is
  -- pinned here so a digit typo (`69900 → 6990`) fails the migration instead
  -- of shipping a wrong ladder to the Stripe bootstrap.
  select count(*) into v_bad
  from public.subscription_plans pl
  left join (values
    ('base', 'personal', 'student', 0),
    ('lite', 'personal', 'educator', 0),
    ('launch', 'organization', null, 0),
    ('spark', 'personal', 'student', 999),
    ('guide', 'personal', 'educator', 1999),
    ('team', 'organization', null, 9900),
    ('ace', 'personal', 'student', 1999),
    ('creator', 'personal', 'educator', 3999),
    ('hub', 'organization', null, 29900),
    ('pro', 'personal', 'student', 3999),
    ('master', 'personal', 'educator', 7999),
    ('campus', 'organization', null, 69900),
    ('solo', 'personal', 'manager', 0)
  ) as expected(key, scope, audience, price) on expected.key = pl.key
  where expected.key is null
     or pl.scope is distinct from expected.scope
     or pl.audience is distinct from expected.audience
     or pl.price_monthly is distinct from expected.price;
  if v_bad <> 0 then
    raise exception 'guard: % plan rows have an unexpected key/scope/audience/price', v_bad
      using errcode = '23514';
  end if;

  -- Every plan's entitlement set is exactly the matrix (per-plan key arrays,
  -- not a total count), so no plan is empty and no plan carries an extra row.
  for v_plan in
    select * from (values
      ('base', array['flashcards', 'quiz']),
      ('lite', array['flashcards', 'quiz']),
      ('launch', array['flashcards', 'quiz']),
      ('solo', array['flashcards', 'quiz']),
      ('spark', array['flashcards', 'quiz']),
      ('guide', array['flashcards', 'quiz', 'quiz.templates']),
      ('team', array['flashcards', 'quiz', 'quiz.templates']),
      ('ace', array['ai.chat', 'flashcards', 'quiz', 'stats.insights']),
      ('creator', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('hub', array['ai.chat', 'branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('pro', array['ai.chat', 'flashcards', 'quiz', 'stats.insights']),
      ('master', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('campus', array['ai.chat', 'branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'])
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
      ('base', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0,"max_students":-1,"max_groups":-1}'::jsonb),
      ('lite', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_groups":1,"max_students":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0}'::jsonb),
      ('launch', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_groups":3,"max_students":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0}'::jsonb),
      ('solo', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0,"max_students":-1,"max_groups":-1}'::jsonb),
      ('spark', '{"max_flashcards":500,"max_questions":200,"max_decks":50,"max_question_banks":20,"max_quiz_attempts_per_day":50,"max_ai_tokens_per_day":0}'::jsonb),
      ('guide', '{"max_flashcards":500,"max_questions":200,"max_decks":50,"max_question_banks":20,"max_groups":5,"max_students":5,"max_quiz_attempts_per_day":50,"max_ai_tokens_per_day":0}'::jsonb),
      ('team', '{"max_flashcards":500,"max_questions":200,"max_decks":50,"max_question_banks":20,"max_groups":5,"max_students":5,"max_quiz_attempts_per_day":50,"max_ai_tokens_per_day":0}'::jsonb),
      ('ace', '{"max_flashcards":2000,"max_questions":1000,"max_decks":200,"max_question_banks":100,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":200000}'::jsonb),
      ('creator', '{"max_flashcards":2000,"max_questions":1000,"max_decks":200,"max_question_banks":100,"max_groups":20,"max_students":50,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":200000}'::jsonb),
      ('hub', '{"max_flashcards":2000,"max_questions":1000,"max_decks":200,"max_question_banks":100,"max_groups":20,"max_students":50,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":200000}'::jsonb),
      ('pro', '{"max_flashcards":-1,"max_questions":-1,"max_decks":-1,"max_question_banks":-1,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":-1}'::jsonb),
      ('master', '{"max_flashcards":-1,"max_questions":-1,"max_decks":-1,"max_question_banks":-1,"max_groups":-1,"max_students":-1,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":-1}'::jsonb),
      ('campus', '{"max_flashcards":-1,"max_questions":-1,"max_decks":-1,"max_question_banks":-1,"max_groups":-1,"max_students":-1,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":-1}'::jsonb)
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

  -- No child row survives outside the matrix (a row on a retired plan would
  -- have to come from a plan row that no longer exists).
  select count(*) into v_bad
  from public.plan_entitlements pe
  where not exists (
    select 1 from plan_catalog_entitlements me
    where me.plan_key = pe.plan_key and me.entitlement_key = pe.entitlement_key
  );
  if v_bad <> 0 then
    raise exception 'guard: % plan_entitlements rows are outside the matrix', v_bad
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from public.plan_limits pl
  where not exists (
    select 1 from plan_catalog_limits ml
    where ml.plan_key = pl.plan_key and ml.limit_key = pl.limit_key
  );
  if v_bad <> 0 then
    raise exception 'guard: % plan_limits rows are outside the matrix', v_bad
      using errcode = '23514';
  end if;

  -- The three flag rows exist (their `is_enabled` value is runtime state).
  select count(*) into v_bad
  from public.entitlement_flags
  where key in ('branding', 'quiz.templates', 'stats.insights');
  if v_bad <> 3 then
    raise exception 'guard: % of the 3 required entitlement_flags rows exist', v_bad
      using errcode = '23514';
  end if;
end $$;

drop table if exists plan_catalog_plans;
drop table if exists plan_catalog_entitlements;
drop table if exists plan_catalog_limits;
