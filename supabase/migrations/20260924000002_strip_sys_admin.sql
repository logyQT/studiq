-- ==========================================================
-- Strip sys_admin completely (#122).
--
-- 1. handle_new_user(): drop the 'sys_admin' -> 'sysadmin'
--    plan branch (the account type no longer exists in the
--    app or the account_type enum).
-- 2. Repoint leftover 'sysadmin' profiles at 'base', then
--    delete the plan (plan_features / plan_limits cascade).
--    The UPDATE must run first: profiles.personal_plan_key
--    FK-references subscription_plans(key).
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
    WHEN 'manager'   THEN 'launch'
    ELSE 'base'
  END;

  INSERT INTO public.profiles (id, email, full_name, personal_plan_key)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', plan_key_val);

  -- Set app_metadata.account_type so withAuth() middleware can read it
  -- without needing a service-role API call from the app layer
  UPDATE auth.users
  SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('account_type', acct_type)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Repoint profiles off the removed plan before deleting it (FK order).
UPDATE public.profiles SET personal_plan_key = 'base' WHERE personal_plan_key = 'sysadmin';

DELETE FROM public.subscription_plans WHERE key = 'sysadmin';
