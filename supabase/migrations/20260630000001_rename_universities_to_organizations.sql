-- ==========================================
-- Migration: Rename universities → organizations
-- + Create multi-org membership tables
-- + Create feature flag & subscription engine tables
-- ==========================================

-- ==========================================
-- STEP 1: Drop triggers referencing old columns
-- ==========================================
DROP TRIGGER IF EXISTS on_profile_role_update ON public.profiles;
DROP TRIGGER IF EXISTS on_univ_id_update ON public.profiles;
DROP FUNCTION IF EXISTS public.sync_profile_role_to_auth();
DROP FUNCTION IF EXISTS public.sync_profile_univ_id_to_auth();

-- ==========================================
-- STEP 2: Rename tables
-- ==========================================
ALTER TABLE public.universities RENAME TO organizations;
ALTER TABLE public.university_subscriptions RENAME TO org_subscriptions;

-- ==========================================
-- STEP 3: Rename FK columns
-- ==========================================
ALTER TABLE public.profiles RENAME COLUMN university_id TO organization_id;
ALTER TABLE public.invitations RENAME COLUMN university_id TO organization_id;
ALTER TABLE public.org_subscriptions RENAME COLUMN university_id TO organization_id;
--ALTER TABLE public.flashcard_spaces RENAME COLUMN university_id TO organization_id;
ALTER TABLE public.flashcard_topics RENAME COLUMN university_id TO organization_id;
ALTER TABLE public.flashcards RENAME COLUMN university_id TO organization_id;
ALTER TABLE public.flashcard_decks RENAME COLUMN university_id TO organization_id;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'questions' AND column_name = 'university_id'
  ) THEN
    ALTER TABLE public.questions RENAME COLUMN university_id TO organization_id;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'subjects' AND column_name = 'university_id'
  ) THEN
    ALTER TABLE public.subjects RENAME COLUMN university_id TO organization_id;
  END IF;
END $$;

-- ==========================================
-- STEP 4: Rename indexes
-- ==========================================
ALTER INDEX IF EXISTS public.idx_flashcard_decks_university RENAME TO idx_flashcard_decks_organization;
ALTER INDEX IF EXISTS public.idx_flashcard_spaces_university RENAME TO idx_flashcard_spaces_organization;
ALTER INDEX IF EXISTS public.idx_flashcard_topics_university RENAME TO idx_flashcard_topics_organization;
ALTER INDEX IF EXISTS public.idx_flashcards_university RENAME TO idx_flashcards_organization;
ALTER INDEX IF EXISTS public.idx_subjects_university RENAME TO idx_subjects_organization;

-- ==========================================
-- STEP 5: Recreate trigger functions with new column names
-- ==========================================
CREATE OR REPLACE FUNCTION public.sync_profile_role_to_auth()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
        coalesce(raw_app_meta_data, '{}'::jsonb) ||
        jsonb_build_object('role', NEW.role)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_profile_role_update
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_role_to_auth();

CREATE OR REPLACE FUNCTION public.sync_profile_org_id_to_auth()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
        coalesce(raw_app_meta_data, '{}'::jsonb) ||
        jsonb_build_object('organization_id', NEW.organization_id)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_id_update
  AFTER INSERT OR UPDATE OF organization_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_org_id_to_auth();

-- Update the handle_new_user trigger to use new column name
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  passed_token  text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record record;
BEGIN
  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record
    FROM public.invitations
    WHERE token      = passed_token
      AND is_accepted = false
      AND expires_at  > now();

    IF FOUND THEN
      INSERT INTO public.profiles (id, email, full_name, role, organization_id)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'name',
        invite_record.target_role,
        invite_record.organization_id
      );

      -- Also create org_members entry
      INSERT INTO public.org_members (organization_id, user_id, role)
      VALUES (invite_record.organization_id, NEW.id, invite_record.target_role)
      ON CONFLICT DO NOTHING;

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: standard free signup
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', 'free');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- STEP 6: Create new tables
-- ==========================================

-- 6a. org_members
CREATE TABLE public.org_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role            user_role NOT NULL,
  joined_at       timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

-- 6b. org_role_display_names
CREATE TABLE public.org_role_display_names (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            user_role NOT NULL,
  display_name    text NOT NULL,
  UNIQUE(organization_id, role)
);

-- 6c. features
CREATE TABLE public.features (
  id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL
);

-- 6d. subscription_plans
CREATE TABLE public.subscription_plans (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name     text NOT NULL,
  category text NOT NULL CHECK (category IN ('individual', 'org')),
  price    integer
);

-- 6e. plan_features
CREATE TABLE public.plan_features (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id       uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  feature_id    uuid NOT NULL REFERENCES public.features(id) ON DELETE CASCADE,
  allowed_roles user_role[] NOT NULL DEFAULT '{}',
  UNIQUE(plan_id, feature_id, allowed_roles)
);

-- ==========================================
-- STEP 7: Data migration
-- ==========================================

-- Migrate existing profiles.organization_id → org_members
INSERT INTO public.org_members (organization_id, user_id, role)
SELECT organization_id, id, role
FROM public.profiles
WHERE organization_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ==========================================
-- STEP 7b: Add plan_id to user_subscriptions
-- ==========================================
ALTER TABLE public.user_subscriptions ADD COLUMN IF NOT EXISTS plan_id uuid REFERENCES public.subscription_plans(id) ON DELETE SET NULL;

-- ==========================================
-- STEP 8: Create indexes
-- ==========================================
CREATE INDEX idx_org_members_org ON public.org_members(organization_id);
CREATE INDEX idx_org_members_user ON public.org_members(user_id);
CREATE INDEX idx_org_role_display_names_org ON public.org_role_display_names(organization_id);
CREATE INDEX idx_plan_features_plan ON public.plan_features(plan_id);
CREATE INDEX idx_plan_features_feature ON public.plan_features(feature_id);

-- ==========================================
-- STEP 9: RLS + Grants
-- ==========================================

-- 9a. org_members
ALTER TABLE public.org_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own org memberships"
  ON public.org_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users insert own org memberships"
  ON public.org_members FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users update own org memberships"
  ON public.org_members FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT ALL ON public.org_members TO authenticated;
GRANT ALL ON public.org_members TO service_role;

-- 9b. org_role_display_names
ALTER TABLE public.org_role_display_names ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members read display names"
  ON public.org_role_display_names FOR SELECT
  TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.org_members
    WHERE organization_id = org_role_display_names.organization_id
    AND user_id = auth.uid()
  ));

GRANT SELECT ON public.org_role_display_names TO authenticated;
GRANT ALL ON public.org_role_display_names TO service_role;

-- 9c. features (read-only for authenticated)
ALTER TABLE public.features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read features"
  ON public.features FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.features TO authenticated;
GRANT ALL ON public.features TO service_role;

-- 9d. subscription_plans (read-only for authenticated)
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plans"
  ON public.subscription_plans FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.subscription_plans TO authenticated;
GRANT ALL ON public.subscription_plans TO service_role;

-- 9e. plan_features (read-only for authenticated)
ALTER TABLE public.plan_features ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read plan features"
  ON public.plan_features FOR SELECT
  TO authenticated
  USING (true);

GRANT SELECT ON public.plan_features TO authenticated;
GRANT ALL ON public.plan_features TO service_role;

-- ==========================================
-- STEP 10: Seed features
-- ==========================================
INSERT INTO public.features (key) VALUES
  ('study.create'),
  ('study.participate'),
  ('test.create'),
  ('test.participate'),
  ('ai.chat'),
  ('org.manage')
ON CONFLICT DO NOTHING;

-- ==========================================
-- STEP 11: Seed subscription plans
-- ==========================================
INSERT INTO public.subscription_plans (name, category, price) VALUES
  ('free', 'individual', 0),
  ('student_premium', 'individual', 999),
  ('teacher_license', 'org', 2999),
  ('org_pro', 'org', 9999)
ON CONFLICT DO NOTHING;
