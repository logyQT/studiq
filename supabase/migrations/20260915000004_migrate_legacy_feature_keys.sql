-- ==========================================================
-- DATA FIX: legacy snake_case feature keys → canonical dotted keys
--
-- The feature-flag rewrite (FeatureResolver, src/server/services/
-- feature.resolver.ts) switched the canonical key format from
-- snake_case ('group_manage') to dotted ('group.manage') with no
-- backward-compat alias layer by design. The code and the seed file
-- (supabase/seeds/00_plans.sql) were updated, but any database that
-- already had orgs/plans provisioned before that change still has
-- the old snake_case values sitting in feature_flags, plan_features,
-- org_role_features and user_feature_overrides — so every feature
-- gate except the handful of keys with no underscore ('flashcards',
-- 'quiz', 'documents') silently resolves to disabled for pre-existing
-- orgs. This repoints existing rows to the dotted key so entitlements
-- granted before the rename keep working.
-- ==========================================================

DO $$
DECLARE
  mapping CONSTANT text[][] := ARRAY[
    ARRAY['ai', 'ai.chat'],
    ARRAY['group_manage', 'group.manage'],
    ARRAY['member_manage', 'member.manage'],
    ARRAY['org_manage', 'org.manage'],
    ARRAY['quiz_builder', 'quiz.builder'],
    ARRAY['role_builder', 'role.builder']
  ];
  m text[];
BEGIN
  -- 1. Make sure the canonical (dotted) catalog row exists, copying the
  --    legacy row's metadata when present.
  FOREACH m SLICE 1 IN ARRAY mapping LOOP
    INSERT INTO public.feature_flags (key, name, description, is_enabled, rollout_percentage)
    SELECT m[2], name, description, is_enabled, rollout_percentage
    FROM public.feature_flags WHERE key = m[1]
    ON CONFLICT (key) DO NOTHING;
  END LOOP;

  -- 2. plan_features: repoint to the dotted key. Drop a row first if it
  --    would collide with one already sitting on the new key.
  FOREACH m SLICE 1 IN ARRAY mapping LOOP
    DELETE FROM public.plan_features p1
    USING public.plan_features p2
    WHERE p1.feature_key = m[1] AND p2.feature_key = m[2] AND p1.plan_key = p2.plan_key;

    UPDATE public.plan_features SET feature_key = m[2] WHERE feature_key = m[1];
  END LOOP;

  -- 3. org_role_features: same repoint (per-org role toggles).
  FOREACH m SLICE 1 IN ARRAY mapping LOOP
    DELETE FROM public.org_role_features o1
    USING public.org_role_features o2
    WHERE o1.feature_key = m[1] AND o2.feature_key = m[2] AND o1.org_role_id = o2.org_role_id;

    UPDATE public.org_role_features SET feature_key = m[2] WHERE feature_key = m[1];
  END LOOP;

  -- 4. user_feature_overrides: same repoint (per-user overrides).
  FOREACH m SLICE 1 IN ARRAY mapping LOOP
    DELETE FROM public.user_feature_overrides u1
    USING public.user_feature_overrides u2
    WHERE u1.feature_key = m[1] AND u2.feature_key = m[2] AND u1.user_id = u2.user_id;

    UPDATE public.user_feature_overrides SET feature_key = m[2] WHERE feature_key = m[1];
  END LOOP;

  -- 5. The legacy catalog rows have no more references now — drop them.
  DELETE FROM public.feature_flags
  WHERE key = ANY(ARRAY['ai', 'group_manage', 'member_manage', 'org_manage', 'quiz_builder', 'role_builder']);
END $$;
