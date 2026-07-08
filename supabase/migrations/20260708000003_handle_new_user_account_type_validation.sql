-- ==========================================================
-- Fix handle_new_user: validate account_type, read from
-- raw_app_meta_data first (seed/admin), then validate
-- client-supplied raw_user_meta_data against whitelist.
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
    WHEN 'sys_admin' THEN 'sysadmin'
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
