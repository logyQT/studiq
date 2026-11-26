-- ==========================================================
-- Plan-catalogue cleanup: the individual keys become Free / Plus / Pro / Max
-- on `free` / `plus` / `pro` / `max`, `audience` leaves the catalogue, and a
-- manager holds no personal plan.
--
-- This is a rename of the same four tiers #1193 shipped on `base` / `spark` /
-- `ace` / `pro`. Prices, entitlements, limits and sort order do not move. The
-- organization ladder (Launch / Hub / Campus) is untouched.
--
-- The rename is declarative and replay-safe: the matrix below is the whole
-- truth for the seven catalogue plans, and the file re-points every reference
-- before it deletes an old row. `pro` is both an old key (Max) and a new key
-- (Pro), so the old row is re-pointed to `max`, deleted, and only then is the
-- new `pro` row inserted; that is the order the rename depends on.
--
-- A manager is an organization buyer (ADR-0007). `profiles.personal_plan_key`
-- becomes nullable and `handle_new_user()` mints `free` for a student or an
-- educator and NULL for a manager.
-- ==========================================================

-- ==========================================================
-- 1. The matrix.
--
-- Prices are minor units (`1999` = 19.99 zł). `sort_order` is global across
-- the ladders: the four personal plans first, then the three organization
-- plans.
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
  ('hub',    'StudiQ Hub',    29900, 'PLN', 6, 'organization'),
  ('campus', 'StudiQ Campus', 69900, 'PLN', 7, 'organization');

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
  ('hub', 'flashcards'), ('hub', 'quiz'),
  ('campus', 'flashcards'), ('campus', 'quiz');

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
  ('hub', 'max_flashcards', 2000), ('hub', 'max_questions', 1000),
  ('hub', 'max_decks', 200), ('hub', 'max_question_banks', 100),
  ('hub', 'max_groups', 20), ('hub', 'max_students', 50),
  ('hub', 'max_quiz_attempts_per_day', -1),
  ('campus', 'max_flashcards', -1), ('campus', 'max_questions', -1),
  ('campus', 'max_decks', -1), ('campus', 'max_question_banks', -1),
  ('campus', 'max_groups', 100), ('campus', 'max_students', 1000),
  ('campus', 'max_quiz_attempts_per_day', -1);

-- ==========================================================
-- 2. The rows every new key needs before a reference can point at it.
--
-- `free`, `plus` and `max` are new keys. `pro` is not: the old `pro` (Max) row
-- still holds that key, so the new `pro` (Pro) row is inserted in step 5, after
-- the old row is re-pointed and deleted.
-- ==========================================================
insert into public.subscription_plans
  (key, name, price_monthly, currency, sort_order, is_active, scope)
select plan_key, name, price_monthly, currency, sort_order, true, scope
from plan_catalog_plans
where plan_key <> 'pro'
on conflict (key) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  currency = excluded.currency,
  sort_order = excluded.sort_order,
  scope = excluded.scope,
  updated_at = now();

-- ==========================================================
-- 3. Re-point `base` and `spark` to `free` and `plus`. The new rows exist
--    after step 2, so the foreign keys accept the move; the old rows are then
--    unreferenced and can go.
-- ==========================================================
update public.profiles p
set personal_plan_key = case p.personal_plan_key
  when 'base' then 'free'
  when 'spark' then 'plus'
end
where p.personal_plan_key in ('base', 'spark');

update public.org_seat_pools sp
set plan_key = case sp.plan_key
  when 'base' then 'free'
  when 'spark' then 'plus'
end
where sp.plan_key in ('base', 'spark');

update public.payments pay
set plan_key = case pay.plan_key
  when 'base' then 'free'
  when 'spark' then 'plus'
end
where pay.plan_key in ('base', 'spark');

update public.stripe_prices spr
set plan_key = case spr.plan_key
  when 'base' then 'free'
  when 'spark' then 'plus'
end
where spr.plan_key in ('base', 'spark');

update public.billing_subscriptions bs
set plan_key = case bs.plan_key
  when 'base' then 'free'
  when 'spark' then 'plus'
end
where bs.plan_key in ('base', 'spark');

update public.billing_subscriptions bs
set pending_plan_key = case bs.pending_plan_key
  when 'base' then 'free'
  when 'spark' then 'plus'
end
where bs.pending_plan_key in ('base', 'spark');

delete from public.subscription_plans
where key in ('base', 'spark');

-- ==========================================================
-- 4. The old `pro` row is the Max tier, and the new `pro` row is the old Ace
--    tier. `pro` is a valid key in both matrices, so the old row is
--    recognised by its own price (7999) rather than by the key alone. On a
--    second application the row at `pro` is already the new Max→Pro tier and
--    the block does nothing.
-- ==========================================================
do $$
declare
  v_legacy_pro boolean;
begin
  select exists (
    select 1
    from public.subscription_plans
    where key = 'pro' and price_monthly = 7999
  ) into v_legacy_pro;

  if not v_legacy_pro then
    return;
  end if;

  update public.profiles set personal_plan_key = 'max' where personal_plan_key = 'pro';
  update public.org_seat_pools set plan_key = 'max' where plan_key = 'pro';
  update public.payments set plan_key = 'max' where plan_key = 'pro';
  update public.stripe_prices set plan_key = 'max' where plan_key = 'pro';
  update public.billing_subscriptions set plan_key = 'max' where plan_key = 'pro';
  update public.billing_subscriptions set pending_plan_key = 'max' where pending_plan_key = 'pro';

  delete from public.subscription_plans where key = 'pro';
end $$;

-- ==========================================================
-- 5. The new `pro` row (the old Ace tier). Step 2 skipped it because the old
--    `pro` row still held the key.
-- ==========================================================
insert into public.subscription_plans
  (key, name, price_monthly, currency, sort_order, is_active, scope)
select plan_key, name, price_monthly, currency, sort_order, true, scope
from plan_catalog_plans
where plan_key = 'pro'
on conflict (key) do update set
  name = excluded.name,
  price_monthly = excluded.price_monthly,
  currency = excluded.currency,
  sort_order = excluded.sort_order,
  scope = excluded.scope,
  updated_at = now();

update public.profiles p
set personal_plan_key = 'pro'
where p.personal_plan_key = 'ace';

update public.org_seat_pools sp
set plan_key = 'pro'
where sp.plan_key = 'ace';

update public.payments pay
set plan_key = 'pro'
where pay.plan_key = 'ace';

update public.stripe_prices spr
set plan_key = 'pro'
where spr.plan_key = 'ace';

update public.billing_subscriptions bs
set plan_key = 'pro'
where bs.plan_key = 'ace';

update public.billing_subscriptions bs
set pending_plan_key = 'pro'
where bs.pending_plan_key = 'ace';

delete from public.subscription_plans where key = 'ace';

-- ==========================================================
-- 6. Every plan outside the matrix is retired. This keeps the file declarative:
--    `db reset` and `db push` end at the same seven rows, and a catalogue row
--    added by hand cannot survive a replay. A profile on a retired plan moves
--    to `free` (a manager to NULL, since they own no personal plan); an
--    organization moves to `launch`; a seat pool is a paid licence, so it
--    aborts with a readable message instead of being silently deleted.
-- ==========================================================
update public.profiles p
set personal_plan_key = case
  when p.account_type = 'manager' then null
  else 'free'
end
where not exists (
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
      'org_seat_pools.% points at retired plan % — re-point or remove the pool before this migration',
      bad.pool_id, bad.plan_key
      using errcode = '23503';
  end loop;
end $$;

delete from public.subscription_plans pl
where not exists (
  select 1 from plan_catalog_plans m where m.plan_key = pl.key
);

-- ==========================================================
-- 7. Declarative children: remove rows the matrix does not list, then insert
--    the matrix. The deleted plans already cascaded their own rows.
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
-- 8. `audience` leaves the catalogue. It stopped keying anything in #1193, and
--    no reader or writer names it now; the column and its two CHECKs go.
-- ==========================================================
alter table public.subscription_plans
  drop constraint if exists subscription_plans_scope_audience_pair_check;
alter table public.subscription_plans
  drop constraint if exists subscription_plans_audience_check;
alter table public.subscription_plans
  drop column if exists audience;

-- ==========================================================
-- 9. A manager is an organization buyer: no personal plan at all. The default
--    is NULL because the persona — not the column — decides which plan a new
--    account starts on, and that decision lives in `handle_new_user()`.
-- ==========================================================
alter table public.profiles
  alter column personal_plan_key drop not null;
alter table public.profiles
  alter column personal_plan_key set default null;

update public.profiles
set personal_plan_key = null
where account_type = 'manager';

-- A profile this catalogue does not describe keeps a usable personal plan
-- unless it belongs to a manager.
update public.profiles p
set personal_plan_key = 'free'
where p.account_type <> 'manager'
  and p.personal_plan_key is not null
  and not exists (
    select 1 from plan_catalog_plans m
    where m.plan_key = p.personal_plan_key and m.scope = 'personal'
  );

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

  if acct_type = 'manager' then
    plan_key_val := null;
  else
    plan_key_val := 'free';
  end if;

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
-- 10. Closing guard (R26): assert the outcome against the literal matrix, not
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
begin
  -- Exactly the seven catalogue plans, with the expected key/scope/price.
  select count(*) into v_plan_count from public.subscription_plans;
  if v_plan_count <> 7 then
    raise exception 'guard: % subscription_plans rows (expected 7)', v_plan_count
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from (values
    ('free', 'personal', 0),
    ('plus', 'personal', 1999),
    ('pro', 'personal', 3999),
    ('max', 'personal', 7999),
    ('launch', 'organization', 0),
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

  -- No old individual key survives anywhere, and no reference points at one.
  select count(*) into v_bad
  from (
    select key from public.subscription_plans
    union all select personal_plan_key from public.profiles
    union all select plan_key from public.org_seat_pools
    union all select plan from public.organizations
    union all select plan_key from public.payments
    union all select plan_key from public.stripe_prices
    union all select plan_key from public.billing_subscriptions
    union all select pending_plan_key from public.billing_subscriptions
  ) refs(key)
  where key in ('base', 'spark', 'ace');
  if v_bad <> 0 then
    raise exception 'guard: % reference(s) still name a retired plan key', v_bad
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

  -- The no-audience decision is in the schema, not only in the readers.
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'subscription_plans'
    and column_name = 'audience';
  if v_bad <> 0 then
    raise exception 'guard: subscription_plans.audience still exists'
      using errcode = '23514';
  end if;

  -- Personal plans are exactly the four ladder keys; organization plans are
  -- capacity-only and unchanged from B2.
  select count(*) into v_bad
  from public.plan_entitlements pe
  join public.subscription_plans p on p.key = pe.plan_key
  where p.scope = 'organization'
    and pe.entitlement_key <> all (array['flashcards', 'quiz']);
  if v_bad <> 0 then
    raise exception 'guard: % organization plan entitlement rows are not baseline keys', v_bad
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
      ('hub', array['flashcards', 'quiz']),
      ('campus', array['flashcards', 'quiz'])
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
      ('hub', '{"max_flashcards":2000,"max_questions":1000,"max_decks":200,"max_question_banks":100,"max_groups":20,"max_students":50,"max_quiz_attempts_per_day":-1}'::jsonb),
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

  -- The individual ladder is finite: no personal cap is `-1`.
  select count(*) into v_bad
  from public.plan_limits pl
  join public.subscription_plans p on p.key = pl.plan_key
  where p.scope = 'personal' and pl.limit_value < 0;
  if v_bad <> 0 then
    raise exception 'guard: % personal plan limits are negative', v_bad
      using errcode = '23514';
  end if;

  -- Personal plan ownership: a manager has none; any other persona has one
  -- from the personal ladder.
  select count(*) into v_bad
  from public.profiles
  where account_type = 'manager' and personal_plan_key is not null;
  if v_bad <> 0 then
    raise exception 'guard: % manager profile(s) still hold a personal plan', v_bad
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

  -- `handle_new_user()` mints `free` for a content subscriber and NULL for a
  -- manager.
  select pg_get_functiondef('public.handle_new_user()'::regprocedure) into v_fn;
  if v_fn is null
     or position('plan_key_val := ''free''' in v_fn) = 0
     or position('plan_key_val := null' in v_fn) = 0
     or position('acct_type = ''manager''' in v_fn) = 0 then
    raise exception 'guard: handle_new_user() does not mint free for a subscriber and null for a manager'
      using errcode = '42883';
  end if;

  if position('''base''' in v_fn) > 0
     or position('''spark''' in v_fn) > 0
     or position('''ace''' in v_fn) > 0 then
    raise exception 'guard: handle_new_user() names a retired plan key'
      using errcode = '42883';
  end if;
end $$;

drop table if exists plan_catalog_plans;
drop table if exists plan_catalog_entitlements;
drop table if exists plan_catalog_limits;
