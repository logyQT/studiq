-- ==========================================================
-- #1193: one individual plan ladder.
--
-- Before this file the catalogue sold two crossed personal ladders keyed by
-- `audience` (`student` Spark/Ace/Pro, `educator` Lite/Guide/Creator/Master)
-- plus a manager-only `solo`. The product now sells one personal ladder —
-- Free / Plus / Pro / Max — to every signed-in reader. `audience` stops
-- keying a plan: a personal plan carries NULL, exactly like an organization
-- plan. Keys stay; the display names, prices, entitlements and limits change.
--
-- The organization ladder (Launch / Team / Hub / Campus) is unchanged. B2
-- owns its next revision.
--
-- Declarative, not additive: the matrix below is the whole truth for the
-- eight catalogue plans. A plan, entitlement or limit row the matrix does not
-- list is deleted, so `db reset` and `db push` end at the same matrix. Applying
-- this file twice leaves that matrix.
-- ==========================================================

-- ==========================================================
-- 1. Drop the old pair CHECK.
--
-- The old CHECK required an audience on every personal plan, which was true
-- only while a persona keyed the ladder. It must go before the matrix upsert
-- writes `audience = NULL`. The replacement (no plan carries an audience) is
-- added after the catalogue update below, when every surviving row is NULL.
-- ==========================================================
alter table public.subscription_plans
  drop constraint if exists subscription_plans_scope_audience_pair_check;

alter table public.profiles alter column personal_plan_key set default 'base';
alter table public.organizations alter column plan set default 'launch';

-- ==========================================================
-- 2. The matrix (declarative source for every statement below).
--
-- Prices are minor units (`1999` = 19.99 zł). `sort_order` is global across
-- the ladders: the four personal plans first, then the four organization
-- plans, so each ladder reads in its own order.
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
  ('base',   'StudiQ Free',   0,     'PLN', 1, 'personal',     null),
  ('spark',  'StudiQ Plus',   1999,  'PLN', 2, 'personal',     null),
  ('ace',    'StudiQ Pro',    3999,  'PLN', 3, 'personal',     null),
  ('pro',    'StudiQ Max',    7999,  'PLN', 4, 'personal',     null),
  ('launch', 'StudiQ Launch', 0,     'PLN', 5, 'organization', null),
  ('team',   'StudiQ Team',   9900,  'PLN', 6, 'organization', null),
  ('hub',    'StudiQ Hub',    29900, 'PLN', 7, 'organization', null),
  ('campus', 'StudiQ Campus', 69900, 'PLN', 8, 'organization', null);

-- Each plan's entitlement set. Free carries the baseline keys only; Plus
-- adds the AI assistant and the saved quiz library; Pro and Max add insights.
drop table if exists plan_catalog_entitlements;
create temp table plan_catalog_entitlements (
  plan_key        text not null,
  entitlement_key text not null,
  primary key (plan_key, entitlement_key)
);

insert into plan_catalog_entitlements (plan_key, entitlement_key) values
  ('base', 'flashcards'), ('base', 'quiz'),
  ('spark', 'flashcards'), ('spark', 'quiz'), ('spark', 'ai.chat'),
  ('spark', 'quiz.templates'),
  ('ace', 'flashcards'), ('ace', 'quiz'), ('ace', 'ai.chat'),
  ('ace', 'quiz.templates'), ('ace', 'stats.insights'),
  ('pro', 'flashcards'), ('pro', 'quiz'), ('pro', 'ai.chat'),
  ('pro', 'quiz.templates'), ('pro', 'stats.insights'),
  ('launch', 'flashcards'), ('launch', 'quiz'),
  ('team', 'flashcards'), ('team', 'quiz'), ('team', 'quiz.templates'),
  ('hub', 'flashcards'), ('hub', 'quiz'), ('hub', 'ai.chat'),
  ('hub', 'quiz.templates'), ('hub', 'stats.insights'), ('hub', 'branding'),
  ('campus', 'flashcards'), ('campus', 'quiz'), ('campus', 'ai.chat'),
  ('campus', 'quiz.templates'), ('campus', 'stats.insights'), ('campus', 'branding');

-- Each plan's limits. A missing `plan_limits` row resolves to 0 (blocked),
-- never to "free", so every plan spells out every key it uses. No personal
-- key is `-1`: the individual ladder is finite by design.
drop table if exists plan_catalog_limits;
create temp table plan_catalog_limits (
  plan_key    text not null,
  limit_key   text not null,
  limit_value int not null,
  primary key (plan_key, limit_key)
);

insert into plan_catalog_limits (plan_key, limit_key, limit_value) values
  ('base', 'max_flashcards', 100), ('base', 'max_questions', 50),
  ('base', 'max_decks', 10), ('base', 'max_question_banks', 5),
  ('base', 'max_quiz_attempts_per_day', 10), ('base', 'max_ai_tokens_per_day', 0),
  ('spark', 'max_flashcards', 1000), ('spark', 'max_questions', 500),
  ('spark', 'max_decks', 100), ('spark', 'max_question_banks', 50),
  ('spark', 'max_quiz_attempts_per_day', 50), ('spark', 'max_ai_tokens_per_day', 100000),
  ('ace', 'max_flashcards', 5000), ('ace', 'max_questions', 2000),
  ('ace', 'max_decks', 500), ('ace', 'max_question_banks', 200),
  ('ace', 'max_quiz_attempts_per_day', 100), ('ace', 'max_ai_tokens_per_day', 250000),
  ('pro', 'max_flashcards', 25000), ('pro', 'max_questions', 10000),
  ('pro', 'max_decks', 2000), ('pro', 'max_question_banks', 1000),
  ('pro', 'max_quiz_attempts_per_day', 200), ('pro', 'max_ai_tokens_per_day', 500000),
  -- Organization ladder, unchanged by B1.
  ('launch', 'max_flashcards', 100), ('launch', 'max_questions', 50),
  ('launch', 'max_decks', 10), ('launch', 'max_question_banks', 5),
  ('launch', 'max_groups', 3), ('launch', 'max_students', 5),
  ('launch', 'max_quiz_attempts_per_day', 10), ('launch', 'max_ai_tokens_per_day', 0),
  ('team', 'max_flashcards', 500), ('team', 'max_questions', 200),
  ('team', 'max_decks', 50), ('team', 'max_question_banks', 20),
  ('team', 'max_groups', 5), ('team', 'max_students', 5),
  ('team', 'max_quiz_attempts_per_day', 50), ('team', 'max_ai_tokens_per_day', 0),
  ('hub', 'max_flashcards', 2000), ('hub', 'max_questions', 1000),
  ('hub', 'max_decks', 200), ('hub', 'max_question_banks', 100),
  ('hub', 'max_groups', 20), ('hub', 'max_students', 50),
  ('hub', 'max_quiz_attempts_per_day', -1), ('hub', 'max_ai_tokens_per_day', 200000),
  ('campus', 'max_flashcards', -1), ('campus', 'max_questions', -1),
  ('campus', 'max_decks', -1), ('campus', 'max_question_banks', -1),
  ('campus', 'max_groups', -1), ('campus', 'max_students', -1),
  ('campus', 'max_quiz_attempts_per_day', -1), ('campus', 'max_ai_tokens_per_day', -1);

-- ==========================================================
-- 3. Plans. `is_active` and `description` stay runtime state: they are
--    inserted once and never overwritten for an existing plan.
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
-- 4. Every plan outside the matrix is retired. A profile on a retired plan
--    moves to `base` for every persona — a manager included — and an
--    organization on a retired plan moves to `launch`. A seat pool is a paid
--    licence, so it aborts with a readable message instead of being silently
--    deleted (the precedent is `20261125170000` step 5).
-- ==========================================================
update public.profiles p
set personal_plan_key = 'base'
where not exists (select 1 from plan_catalog_plans m where m.plan_key = p.personal_plan_key);

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

-- No plan carries an audience (#1193). Every surviving row is now NULL. The
-- column stays (no schema churn for readers), and the CHECK rejects any
-- non-null value from here on.
alter table public.subscription_plans
  add constraint subscription_plans_scope_audience_pair_check check (audience is null);

-- ==========================================================
-- 5. Declarative children: remove rows the matrix does not list, then insert
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
-- 6. New accounts start on the one free personal plan, whatever the persona.
--    The manager exemption (`solo`) retires with the audience keying.
-- ==========================================================
create or replace function public.handle_new_user()
returns trigger as $$
declare
  acct_type    text;
  plan_key_val text;
begin
  -- Prefer app_meta_data (server-controlled — seed, admin APIs).
  -- Fallback to user_meta_data (client-supplied from signup) with validation.
  acct_type := NEW.raw_app_meta_data->>'account_type';

  if acct_type is null then
    acct_type := NEW.raw_user_meta_data->>'account_type';

    if acct_type is null or acct_type not in ('student', 'educator', 'manager') then
      raise exception 'Invalid account_type: %. Allowed: student, educator, manager', acct_type;
    end if;
  end if;

  plan_key_val := 'base';

  insert into public.profiles (id, email, full_name, personal_plan_key, account_type)
  values (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', plan_key_val, acct_type::public.account_type);

  -- Set app_metadata.account_type so withAuth() middleware can read it
  -- without needing a service-role API call from the app layer
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_type', acct_type)
  where id = NEW.id;

  return NEW;
end;
$$ language plpgsql security definer;

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
  v_fn text;
  v_assign int;
  v_key text;
begin
  -- Exactly the eight catalogue plans …
  select count(*) into v_plan_count from public.subscription_plans;
  if v_plan_count <> 8 then
    raise exception 'guard: % subscription_plans rows (expected 8)', v_plan_count
      using errcode = '23514';
  end if;

  -- … with the expected scope/audience pair and price. `price_monthly` is
  -- pinned here so a digit typo fails the migration instead of shipping a
  -- wrong ladder to the Stripe bootstrap.
  select count(*) into v_bad
  from public.subscription_plans pl
  left join (values
    ('base', 'personal', null::text, 0),
    ('spark', 'personal', null::text, 1999),
    ('ace', 'personal', null::text, 3999),
    ('pro', 'personal', null::text, 7999),
    ('launch', 'organization', null::text, 0),
    ('team', 'organization', null::text, 9900),
    ('hub', 'organization', null::text, 29900),
    ('campus', 'organization', null::text, 69900)
  ) as expected(key, scope, audience, price) on expected.key = pl.key
  where expected.key is null
     or pl.scope is distinct from expected.scope
     or pl.audience is distinct from expected.audience
     or pl.price_monthly is distinct from expected.price;
  if v_bad <> 0 then
    raise exception 'guard: % plan rows have an unexpected key/scope/audience/price', v_bad
      using errcode = '23514';
  end if;

  -- No plan carries an audience (#1193). The CHECK enforces this on every
  -- write; this guard states the invariant against the live rows as well.
  select count(*) into v_bad
  from public.subscription_plans
  where audience is not null;
  if v_bad <> 0 then
    raise exception 'guard: % plan rows carry an audience', v_bad
      using errcode = '23514';
  end if;

  -- Every plan's entitlement set is exactly the matrix (per-plan key arrays,
  -- not a total count), so no plan is empty and no plan carries an extra row.
  for v_plan in
    select * from (values
      ('base', array['flashcards', 'quiz']),
      ('spark', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates']),
      ('ace', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('pro', array['ai.chat', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
      ('launch', array['flashcards', 'quiz']),
      ('team', array['flashcards', 'quiz', 'quiz.templates']),
      ('hub', array['ai.chat', 'branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights']),
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
      ('base', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0}'::jsonb),
      ('spark', '{"max_flashcards":1000,"max_questions":500,"max_decks":100,"max_question_banks":50,"max_quiz_attempts_per_day":50,"max_ai_tokens_per_day":100000}'::jsonb),
      ('ace', '{"max_flashcards":5000,"max_questions":2000,"max_decks":500,"max_question_banks":200,"max_quiz_attempts_per_day":100,"max_ai_tokens_per_day":250000}'::jsonb),
      ('pro', '{"max_flashcards":25000,"max_questions":10000,"max_decks":2000,"max_question_banks":1000,"max_quiz_attempts_per_day":200,"max_ai_tokens_per_day":500000}'::jsonb),
      ('launch', '{"max_flashcards":100,"max_questions":50,"max_decks":10,"max_question_banks":5,"max_groups":3,"max_students":5,"max_quiz_attempts_per_day":10,"max_ai_tokens_per_day":0}'::jsonb),
      ('team', '{"max_flashcards":500,"max_questions":200,"max_decks":50,"max_question_banks":20,"max_groups":5,"max_students":5,"max_quiz_attempts_per_day":50,"max_ai_tokens_per_day":0}'::jsonb),
      ('hub', '{"max_flashcards":2000,"max_questions":1000,"max_decks":200,"max_question_banks":100,"max_groups":20,"max_students":50,"max_quiz_attempts_per_day":-1,"max_ai_tokens_per_day":200000}'::jsonb),
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

  -- The individual ladder is finite: no personal cap is `-1`.
  select count(*) into v_bad
  from public.plan_limits pl
  join public.subscription_plans p on p.key = pl.plan_key
  where p.scope = 'personal' and pl.limit_value < 0;
  if v_bad <> 0 then
    raise exception 'guard: % personal plan limits are negative', v_bad
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

  -- Every new account starts on `base`, whatever the persona. The function
  -- must assign the plan key exactly once, to base: a per-persona branch would
  -- either add a second assignment or replace this one.
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_fn;
  v_assign := (length(v_fn) - length(replace(v_fn, 'plan_key_val :=', '')))
    / length('plan_key_val :=');
  if v_fn is null
     or position('plan_key_val := ''base''' in v_fn) = 0
     or v_assign <> 1 then
    raise exception 'guard: handle_new_user() does not mint base for every persona'
      using errcode = '42883';
  end if;

  -- No retired plan key survives in the function.
  foreach v_key in array array['solo', 'lite', 'guide', 'creator', 'master'] loop
    if position('''' || v_key || '''' in v_fn) > 0 then
      raise exception 'guard: handle_new_user() names retired plan key %', v_key
        using errcode = '42883';
    end if;
  end loop;
end $$;

drop table if exists plan_catalog_plans;
drop table if exists plan_catalog_entitlements;
drop table if exists plan_catalog_limits;
