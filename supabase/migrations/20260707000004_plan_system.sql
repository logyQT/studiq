-- ==========================================
-- MIGRATION: Plan system — personal plans, limits, token tracking
-- ==========================================

-- 1. plan_limits table (flexible rows, not schema-locked)
CREATE TABLE public.plan_limits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key    text NOT NULL REFERENCES public.subscription_plans(key) ON DELETE CASCADE,
  limit_key   text NOT NULL,
  limit_value int NOT NULL DEFAULT -1,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(plan_key, limit_key)
);

-- 2. personal_plan_key on profiles
ALTER TABLE public.profiles
  ADD COLUMN personal_plan_key text NOT NULL DEFAULT 'free'
    REFERENCES public.subscription_plans(key);

-- 3. Token tracking on user_daily_activity
ALTER TABLE public.user_daily_activity
  ADD COLUMN ai_input_tokens  int NOT NULL DEFAULT 0,
  ADD COLUMN ai_output_tokens int NOT NULL DEFAULT 0;

-- 4. free_educator plan
INSERT INTO public.subscription_plans (key, name, description, price_monthly, sort_order)
VALUES ('free_educator', 'Free Educator', 'Free plan for educators — manage up to 5 students, extended limits', 0, 4)
ON CONFLICT DO NOTHING;

-- 5. Plan features for free_educator
INSERT INTO public.plan_features (plan_key, feature_key) VALUES
  ('free_educator', 'flashcards'),
  ('free_educator', 'quiz'),
  ('free_educator', 'org.manage')
ON CONFLICT DO NOTHING;

-- 6. Seed plan limits
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  -- Free (student)
  ('free', 'max_flashcards', 100),
  ('free', 'max_questions', 50),
  ('free', 'max_decks', 10),
  ('free', 'max_question_banks', 5),
  ('free', 'max_quiz_attempts_per_day', 10),
  ('free', 'max_ai_tokens_per_day', 0),
  -- Free educator
  ('free_educator', 'max_flashcards', 1000),
  ('free_educator', 'max_questions', 500),
  ('free_educator', 'max_decks', 50),
  ('free_educator', 'max_question_banks', 20),
  ('free_educator', 'max_students', 5),
  ('free_educator', 'max_groups', 5),
  ('free_educator', 'max_quiz_attempts_per_day', 50),
  ('free_educator', 'max_ai_tokens_per_day', 0),
  -- Premium
  ('premium', 'max_flashcards', -1),
  ('premium', 'max_questions', -1),
  ('premium', 'max_decks', -1),
  ('premium', 'max_question_banks', -1),
  ('premium', 'max_quiz_attempts_per_day', -1),
  ('premium', 'max_ai_tokens_per_day', 200000),
  -- School
  ('school', 'max_flashcards', -1),
  ('school', 'max_questions', -1),
  ('school', 'max_decks', -1),
  ('school', 'max_question_banks', -1),
  ('school', 'max_students', -1),
  ('school', 'max_groups', -1),
  ('school', 'max_quiz_attempts_per_day', -1),
  ('school', 'max_ai_tokens_per_day', -1),
  ('school', 'max_storage_mb', -1),
  -- Sysadmin
  ('sysadmin', 'max_flashcards', -1),
  ('sysadmin', 'max_questions', -1),
  ('sysadmin', 'max_decks', -1),
  ('sysadmin', 'max_question_banks', -1),
  ('sysadmin', 'max_students', -1),
  ('sysadmin', 'max_groups', -1),
  ('sysadmin', 'max_quiz_attempts_per_day', -1),
  ('sysadmin', 'max_ai_tokens_per_day', -1),
  ('sysadmin', 'max_storage_mb', -1)
ON CONFLICT DO NOTHING;

-- 7. Update handle_new_user trigger — set personal_plan_key from account_type
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  passed_token     text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record    record;
  plan_key_val     text;
BEGIN
  plan_key_val := CASE NEW.raw_user_meta_data->>'account_type'
    WHEN 'educator' THEN 'free_educator'
    WHEN 'manager' THEN 'free_educator'
    WHEN 'sys_admin' THEN 'sysadmin'
    ELSE 'free'
  END;

  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record
    FROM public.invitations
    WHERE token      = passed_token
      AND is_accepted = false
      AND expires_at  > now();

    IF FOUND THEN
      INSERT INTO public.profiles (id, email, full_name, personal_plan_key)
      VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', plan_key_val);

      INSERT INTO public.org_members (organization_id, user_id, org_role_id)
      VALUES (invite_record.organization_id, NEW.id, invite_record.target_org_role_id)
      ON CONFLICT DO NOTHING;

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name, personal_plan_key)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', plan_key_val);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
