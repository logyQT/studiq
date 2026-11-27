-- ==========================================================
-- #1493 amendment: the organization ladder gains Team, and the four organization
-- tiers carry cumulative features again.
--
-- B2 (#1493) shipped three capacity-only organization tiers and folded `team`
-- into `hub`. The operator settled the ladder as four purchasable tiers on
-- 2026-11-27: Launch (free) / Team 99 / Hub 299 / Campus 699. The cards now
-- differentiate on capacity **and** features, cumulatively:
--
--   launch  flashcards, quiz
--   team    + quiz.templates
--   hub     + stats.insights
--   campus  + branding
--
-- Campus stays a priced, self-serve tier. Custom setup is a separate contact CTA,
-- not a plan card, so no plan is sales-led.
--
-- Declarative, not additive: the matrix below is the whole truth for the eight
-- catalogue plans (#1193's four personal plans plus these four). A plan,
-- entitlement or limit row the matrix does not list is deleted, so `db reset`
-- and `db push` end at the same matrix. Applying this file twice leaves that
-- matrix.
--
-- The individual ladder is untouched: its four keys, prices, entitlements and
-- limits are pinned again only so the declarative cleanup cannot drift them.
-- An organization plan is never a seat pool: a pool is a licence of a personal
-- plan (D15/D32).
-- ==========================================================

-- ==========================================================
-- 1. The matrix (declarative source for every statement below).
--
-- Prices are minor units (`9900` = 99.00 zł). `sort_order` is global across the
-- ladders: the four personal plans first, then the four organization plans.
-- ==========================================================
drop table if exists plan_catalog_plans;
create temp table plan_catalog_plans (
  plan_key      text primary key,
  name          text not null,
  price_monthly int not null,
  currency      text not null,
  sort_order    int not null,
  scope         text not null
);

insert into plan_catalog_plans
  (plan_key, name, price_monthly, currency, sort_order, scope)
values
  ('free',   'StudiQ Free',   0,     'PLN', 1, 'personal'),
  ('plus',   'StudiQ Plus',   1999,  'PLN', 2, 'personal'),
  ('pro',    'StudiQ Pro',    3999,  'PLN', 3, 'personal'),
  ('max',    'StudiQ Max',    7999,  'PLN', 4, 'personal'),
  ('launch', 'StudiQ Launch', 0,     'PLN', 5, 'organization'),
  ('team',   'StudiQ Team',   9900,  'PLN', 6, 'organization'),
  ('hub',    'StudiQ Hub',    29900, 'PLN', 7, 'organization'),
  ('campus', 'StudiQ Campus', 69900, 'PLN', 8, 'organization');

-- Each plan's entitlement set. The personal ladder keeps the paid surfaces. The
-- organization ladder is cumulative: every tier carries the tier below it plus
-- one surface. No organization plan carries `ai.chat`: AI is an organization
-- licence built in #1511, and a stale entitlement would silently fund it.
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
  ('campus', 'stats.insights'), ('campus', 'branding');

-- Each plan's limits. A missing `plan_limits` row resolves to 0 (blocked),
-- never to "free". No organization plan carries `max_ai_tokens_per_day`.
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
  ('campus', 'max_quiz_attempts_per_day', -1);

-- ==========================================================
-- 2. Plans. `is_active` and `description` stay runtime state: they are inserted
--    once and never overwritten for an existing plan.
-- ==========================================================
insert into public.subscription_plans
  (key, name, price_monthly, currency, sort_order, is_active, scope)
select plan_key, name, price_monthly, currency, sort_order, true, scope
from plan_catalog_plans
on conflict (key) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  currency = excluded.currency,
  sort_order = excluded.sort_order,
  scope = excluded.scope,
  updated_at = now();

-- ==========================================================
-- 3. Every plan outside the matrix is retired. A profile on one moves to
--    `free`; an organization on one moves to `launch`. A seat pool is a paid
--    licence, so it aborts with a readable message instead of being silently
--    deleted, and it must reference a personal plan — an organization plan is
--    never a pool (D15/D32).
-- ==========================================================
update public.profiles p
set personal_plan_key = 'free'
where p.personal_plan_key is not null
  and not exists (
    select 1 from plan_catalog_plans m
    where m.plan_key = p.personal_plan_key and m.scope = 'personal'
  );

do $$
declare
  v_rows int;
  v_keys text;
begin
  select string_agg(distinct o.plan, ', ' order by o.plan)
    into v_keys
  from public.organizations o
  where not exists (
    select 1 from plan_catalog_plans m
    where m.plan_key = o.plan and m.scope = 'organization'
  );

  update public.organizations o
  set plan = 'launch'
  where not exists (
    select 1 from plan_catalog_plans m
    where m.plan_key = o.plan and m.scope = 'organization'
  );
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
    where not exists (
      select 1 from plan_catalog_plans m
      where m.plan_key = sp.plan_key and m.scope = 'personal'
    )
  loop
    raise exception
      'org_seat_pools.% points at plan % — a pool must be a personal plan in the catalogue',
      bad.pool_id, bad.plan_key
      using errcode = '23503';
  end loop;
end $$;

delete from public.subscription_plans pl
where not exists (
  select 1 from plan_catalog_plans m where m.plan_key = pl.key
);

-- ==========================================================
-- 4. Declarative children: remove rows the matrix does not list, then insert
--    the matrix.
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
-- 5. Closing guard (R26): assert the outcome against the literal matrix, not
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
  -- Exactly the eight catalogue plans …
  select count(*) into v_plan_count from public.subscription_plans;
  if v_plan_count <> 8 then
    raise exception 'guard: % subscription_plans rows (expected 8)', v_plan_count
      using errcode = '23514';
  end if;

  -- … with the expected key/scope/price. `price_monthly` is pinned here so a
  -- digit typo fails the migration instead of shipping a wrong ladder to the
  -- Stripe bootstrap.
  select count(*) into v_bad
  from (values
    ('free', 'personal', 0),
    ('plus', 'personal', 1999),
    ('pro', 'personal', 3999),
    ('max', 'personal', 7999),
    ('launch', 'organization', 0),
    ('team', 'organization', 9900),
    ('hub', 'organization', 29900),
    ('campus', 'organization', 69900)
  ) as expected(key, scope, price)
  left join public.subscription_plans pl on pl.key = expected.key
  where pl.key is null
     or pl.scope is distinct from expected.scope
     or pl.price_monthly is distinct from expected.price;
  if v_bad <> 0 then
    raise exception 'guard: % plan rows have an unexpected key/scope/price', v_bad
      using errcode = '23514';
  end if;

  -- The organization ladder is exactly the four tiers, in the settled order.
  select count(*) into v_bad
  from (values
    ('launch', 5), ('team', 6), ('hub', 7), ('campus', 8)
  ) as expected(key, sort_order)
  left join public.subscription_plans pl on pl.key = expected.key
  where pl.key is null
     or pl.scope is distinct from 'organization'
     or pl.sort_order is distinct from expected.sort_order;
  if v_bad <> 0 then
    raise exception 'guard: % organization plan rows have an unexpected key/sort_order', v_bad
      using errcode = '23514';
  end if;

  -- An organization stays on the organization ladder.
  select count(*) into v_bad
  from public.organizations o
  where not exists (
    select 1 from public.subscription_plans pl
    where pl.key = o.plan and pl.scope = 'organization'
  );
  if v_bad <> 0 then
    raise exception 'guard: % organization(s) sit outside the organization ladder', v_bad
      using errcode = '23514';
  end if;

  -- A seat pool is a personal plan's licence, never an organization tier.
  select count(*) into v_bad
  from public.org_seat_pools sp
  where not exists (
    select 1 from public.subscription_plans pl
    where pl.key = sp.plan_key and pl.scope = 'personal'
  );
  if v_bad <> 0 then
    raise exception 'guard: % seat pool(s) reference a non-personal plan', v_bad
      using errcode = '23514';
  end if;

  -- Every plan's entitlement set is exactly the matrix (per-plan key arrays).
  for v_plan in
    select * from (values
      ('free', array['flashcards', 'quiz']),
      ('plus', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates']),
      ('pro', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('max', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('launch', array['flashcards', 'quiz']),
      ('team', array['flashcards', 'quiz', 'quiz.templates']),
      ('hub', array['flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('campus', array['branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'])
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

  -- The per-plan literal sets above are the cumulative-matrix guard: a tier that
  -- drops a key fails its own entry, so a separate subset check cannot fail alone.

  -- No organization plan carries an org AI entitlement or quota. AI is an
  -- organization licence built in #1511.
  select count(*) into v_bad
  from public.plan_entitlements pe
  join public.subscription_plans p on p.key = pe.plan_key
  where p.scope = 'organization'
    and pe.entitlement_key = 'ai.chat';
  if v_bad <> 0 then
    raise exception 'guard: % organization plan(s) carry ai.chat', v_bad
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from public.plan_limits pl
  join public.subscription_plans p on p.key = pl.plan_key
  where p.scope = 'organization'
    and pl.limit_key = 'max_ai_tokens_per_day';
  if v_bad <> 0 then
    raise exception 'guard: % organization plans carry an AI quota', v_bad
      using errcode = '23514';
  end if;

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
      ('campus', '{"max_flashcards":-1,"max_questions":-1,"max_decks":-1,"max_question_banks":-1,"max_groups":100,"max_students":1000,"max_quiz_attempts_per_day":-1}'::jsonb)
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

  -- No child row survives outside the matrix.
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

  -- The individual ladder is finite: no personal cap is `-1`, and every
  -- non-manager profile keeps a personal plan from it.
  select count(*) into v_bad
  from public.plan_limits pl
  join public.subscription_plans p on p.key = pl.plan_key
  where p.scope = 'personal' and pl.limit_value < 0;
  if v_bad <> 0 then
    raise exception 'guard: % personal plan limits are negative', v_bad
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from public.profiles p
  where p.account_type <> 'manager'
    and (
      p.personal_plan_key is null
      or not exists (
        select 1 from public.subscription_plans pl
        where pl.key = p.personal_plan_key and pl.scope = 'personal'
      )
    );
  if v_bad <> 0 then
    raise exception 'guard: % non-manager profile(s) lack a personal plan', v_bad
      using errcode = '23514';
  end if;
end $$;

drop table if exists plan_catalog_plans;
drop table if exists plan_catalog_entitlements;
drop table if exists plan_catalog_limits;
