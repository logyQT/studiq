-- ==========================================================
-- ADR-0015 phase 4a (D32/D33): plan scope/audience replace
-- `for_account_type`; `solo` becomes the free manager
-- personal plan; `profiles.account_type` is added and kept
-- in step with the JWT by the only writer that changes it;
-- `org_seat_pools.plan_key` gains the plan FK.
--
-- Replay-safe: every DDL is IF NOT EXISTS / DROP IF EXISTS,
-- every insert is ON CONFLICT DO NOTHING, and the
-- `for_account_type` backfill only runs while that column
-- still exists.
-- ==========================================================

-- ==========================================================
-- 1. profiles.account_type (D33)
--    Backfilled from the JWT app metadata (the same source
--    `withAuth` reads); anything absent or unknown falls
--    back to 'student'.
-- ==========================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_type public.account_type NOT NULL DEFAULT 'student';

DO $$
BEGIN
  UPDATE public.profiles p
  SET account_type = CASE
        WHEN u.raw_app_meta_data->>'account_type' IN ('student', 'educator', 'manager')
          THEN (u.raw_app_meta_data->>'account_type')::public.account_type
        ELSE 'student'::public.account_type
      END
  FROM auth.users u
  WHERE u.id = p.id;
END $$;

-- ==========================================================
-- 2. subscription_plans.scope / audience (D32)
--    Backfill from `for_account_type`: 'manager' is the
--    organization family (audience NULL), the other two
--    audiences are personal plans. Any other non-null value
--    fails closed — the migration raises instead of guessing.
-- ==========================================================
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS scope text;
ALTER TABLE public.subscription_plans ADD COLUMN IF NOT EXISTS audience text;

DO $$
DECLARE
  bad_key text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_attribute
    WHERE attrelid = 'public.subscription_plans'::regclass
      AND attname = 'for_account_type'
      AND NOT attisdropped
  ) THEN
    SELECT key INTO bad_key
    FROM public.subscription_plans
    WHERE for_account_type IS NOT NULL
      AND for_account_type NOT IN ('student', 'educator', 'manager')
    LIMIT 1;

    IF bad_key IS NOT NULL THEN
      RAISE EXCEPTION
        'subscription_plans.% has an unknown for_account_type — refusing to guess its scope',
        bad_key
        USING ERRCODE = '22023';
    END IF;

    -- A NULL `for_account_type` (the legacy pre-catalog rows the seed deletes
    -- later) maps to the organization family: it is the only shape with a NULL
    -- audience the pair CHECK accepts, and checkout applies no audience check
    -- to organization plans — the closest match to the old "no family" meaning.
    UPDATE public.subscription_plans
    SET scope = CASE
          WHEN for_account_type IS NULL OR for_account_type = 'manager' THEN 'organization'
          ELSE 'personal'
        END,
        audience = CASE
          WHEN for_account_type IN ('student', 'educator') THEN for_account_type
          ELSE NULL
        END
    WHERE scope IS NULL;
  END IF;
END $$;

ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_scope_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_scope_check CHECK (scope IN ('personal', 'organization'));
ALTER TABLE public.subscription_plans ALTER COLUMN scope SET NOT NULL;

ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_audience_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_audience_check CHECK (audience IN ('student', 'educator', 'manager'));

ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS subscription_plans_scope_audience_pair_check;
ALTER TABLE public.subscription_plans
  ADD CONSTRAINT subscription_plans_scope_audience_pair_check CHECK (
    (scope = 'organization' AND audience IS NULL)
    OR (scope = 'personal' AND audience IS NOT NULL)
  );

-- No dual truth: the old column goes in the same migration.
ALTER TABLE public.subscription_plans DROP COLUMN IF EXISTS for_account_type;

-- ==========================================================
-- 3. The `solo` plan (D2/D32): the free manager personal
--    plan, baseline entitlements only. Its limits mirror the
--    free-tier `base` rows exactly (the seed repeats them
--    explicitly for a database that runs migrations before
--    the plan catalog exists).
-- ==========================================================
INSERT INTO public.subscription_plans
  (key, name, price_monthly, currency, sort_order, is_active, scope, audience)
VALUES
  ('solo', 'StudiQ Solo', 0, 'PLN', 13, true, 'personal', 'manager')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.plan_entitlements (plan_key, entitlement_key) VALUES
  ('solo', 'flashcards'),
  ('solo', 'quiz')
ON CONFLICT DO NOTHING;

-- The free-tier values, spelled out: `db push` runs on a project whose plan
-- catalog may be empty (the seeds are a fresh-project bootstrap), so copying
-- `base`'s rows here would leave `solo` without limits — and a missing
-- `plan_limits` row resolves to 0 (blocked), not to "free".
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('solo', 'max_flashcards', 100),
  ('solo', 'max_questions', 50),
  ('solo', 'max_decks', 10),
  ('solo', 'max_question_banks', 5),
  ('solo', 'max_quiz_attempts_per_day', 10),
  ('solo', 'max_ai_tokens_per_day', 0),
  ('solo', 'max_students', -1),
  ('solo', 'max_groups', -1)
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 4. Backfill legacy manager personal plans (D32): every
--    manager whose personal plan is an organization-scope
--    plan (the old `launch` dual-purpose row) moves to
--    `solo`. Non-managers are untouched.
-- ==========================================================
UPDATE public.profiles p
SET personal_plan_key = 'solo'
FROM public.subscription_plans pl
WHERE p.personal_plan_key = pl.key
  AND p.account_type = 'manager'
  AND pl.scope = 'organization';

-- ==========================================================
-- 5. org_seat_pools.plan_key FK (D15/D32)
--    A pool is a licence of a personal plan. An existing pool
--    pointing at a non-personal plan aborts the migration
--    with a readable message — customer rows are never
--    deleted silently.
-- ==========================================================
DO $$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT sp.id AS pool_id, sp.plan_key
    FROM public.org_seat_pools sp
    JOIN public.subscription_plans pl ON pl.key = sp.plan_key
    WHERE pl.scope <> 'personal'
  LOOP
    RAISE EXCEPTION
      'org_seat_pools.% points at non-personal plan % — re-point or remove the pool before this migration',
      bad.pool_id, bad.plan_key
      USING ERRCODE = '23503';
  END LOOP;
END $$;

ALTER TABLE public.org_seat_pools DROP CONSTRAINT IF EXISTS org_seat_pools_plan_key_fkey;
ALTER TABLE public.org_seat_pools
  ADD CONSTRAINT org_seat_pools_plan_key_fkey
  FOREIGN KEY (plan_key) REFERENCES public.subscription_plans(key);

-- ==========================================================
-- 6. handle_new_user(): managers get `solo` (not `launch`)
--    and the profile row now carries account_type, so the
--    JWT and the profile can never drift apart.
-- ==========================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  acct_type    text;
  plan_key_val text;
BEGIN
  -- Prefer app_meta_data (server-controlled — seed, admin APIs).
  -- Fallback to user_meta_data (client-supplied from signup) with validation.
  acct_type := NEW.raw_app_meta_data->>'account_type';

  IF acct_type IS NULL THEN
    acct_type := NEW.raw_user_meta_data->>'account_type';

    IF acct_type IS NULL OR acct_type NOT IN ('student', 'educator', 'manager') THEN
      RAISE EXCEPTION 'Invalid account_type: %. Allowed: student, educator, manager', acct_type;
    END IF;
  END IF;

  plan_key_val := CASE acct_type
    WHEN 'student'   THEN 'base'
    WHEN 'educator'  THEN 'lite'
    WHEN 'manager'   THEN 'solo'
    ELSE 'base'
  END;

  INSERT INTO public.profiles (id, email, full_name, personal_plan_key, account_type)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', plan_key_val, acct_type::public.account_type);

  -- Set app_metadata.account_type so withAuth() middleware can read it
  -- without needing a service-role API call from the app layer
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_type', acct_type)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================================
-- 7. `PlanInfo.seatEligible` reads `entitlement_catalog` on every plan read,
--    including the anonymous pricing catalogue (which embeds the catalog from
--    `plan_entitlements`). Without this grant that embed raises 42501 for
--    `anon` and the public catalogue answers 403.
-- ==========================================================
GRANT SELECT ON public.entitlement_catalog TO anon;

-- ==========================================================
-- 8. Closing guard: pin the state this file creates.
-- ==========================================================
DO $$
DECLARE
  bad_plans        int;
  solo             public.subscription_plans%ROWTYPE;
  solo_limits      int;
  bad_seat_keys    int;
  mgr_org_plans    int;
  fk_count         int;
  fn_def           text;
BEGIN
  -- No plan violates the scope/audience CHECKs (defence in depth beside
  -- the constraints themselves).
  SELECT count(*) INTO bad_plans
  FROM public.subscription_plans
  WHERE scope NOT IN ('personal', 'organization')
     OR (audience IS NOT NULL AND audience NOT IN ('student', 'educator', 'manager'))
     OR (scope = 'organization' AND audience IS NOT NULL)
     OR (scope = 'personal' AND audience IS NULL);
  IF bad_plans <> 0 THEN
    RAISE EXCEPTION 'guard: % subscription_plans rows violate the scope/audience CHECKs', bad_plans
      USING ERRCODE = '23514';
  END IF;

  -- `solo` exists as the free personal manager plan.
  SELECT * INTO solo FROM public.subscription_plans WHERE key = 'solo';
  IF solo IS NULL
     OR solo.scope <> 'personal'
     OR solo.audience <> 'manager'
     OR solo.price_monthly <> 0
     OR solo.is_active IS NOT TRUE THEN
    RAISE EXCEPTION 'guard: the solo plan is missing or has the wrong scope/audience/price'
      USING ERRCODE = '23514';
  END IF;

  -- `solo` carries the free tier's limit rows, so a manager outside an org
  -- resolves the free allowance instead of the "missing row = 0" block.
  SELECT count(*) INTO solo_limits FROM public.plan_limits WHERE plan_key = 'solo';
  IF solo_limits < 8 THEN
    RAISE EXCEPTION 'guard: the solo plan has % limit rows (expected the free tier''s eight)', solo_limits
      USING ERRCODE = '23514';
  END IF;

  -- Every personal plan's entitlement keys are all seatEligible in the
  -- live entitlement_catalog (a pool's plan must be a licence, D15).
  SELECT count(*) INTO bad_seat_keys
  FROM public.plan_entitlements pe
  JOIN public.subscription_plans pl ON pl.key = pe.plan_key
  LEFT JOIN public.entitlement_catalog ec ON ec.key = pe.entitlement_key
  WHERE pl.scope = 'personal'
    AND (ec.key IS NULL OR ec.seat_eligible IS NOT TRUE);
  IF bad_seat_keys <> 0 THEN
    RAISE EXCEPTION 'guard: % personal-plan entitlement keys are not seatEligible in entitlement_catalog', bad_seat_keys
      USING ERRCODE = '23514';
  END IF;

  -- No manager profile holds an organization-scope personal plan.
  SELECT count(*) INTO mgr_org_plans
  FROM public.profiles p
  JOIN public.subscription_plans pl ON pl.key = p.personal_plan_key
  WHERE p.account_type = 'manager' AND pl.scope = 'organization';
  IF mgr_org_plans <> 0 THEN
    RAISE EXCEPTION 'guard: % manager profiles still hold an organization-scope plan', mgr_org_plans
      USING ERRCODE = '23514';
  END IF;

  -- The org_seat_pools.plan_key FK exists.
  SELECT count(*) INTO fk_count
  FROM pg_constraint
  WHERE conrelid = 'public.org_seat_pools'::regclass
    AND conname = 'org_seat_pools_plan_key_fkey'
    AND contype = 'f';
  IF fk_count <> 1 THEN
    RAISE EXCEPTION 'guard: org_seat_pools_plan_key_fkey is missing'
      USING ERRCODE = '42704';
  END IF;

  -- handle_new_user() mentions `solo` (managers no longer get `launch`).
  SELECT pg_get_functiondef('public.handle_new_user()'::regprocedure) INTO fn_def;
  IF fn_def IS NULL OR position('solo' IN fn_def) = 0 THEN
    RAISE EXCEPTION 'guard: handle_new_user() does not mention solo'
      USING ERRCODE = '42883';
  END IF;
END $$;
