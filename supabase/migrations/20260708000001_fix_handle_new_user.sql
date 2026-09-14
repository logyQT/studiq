-- ==========================================================
-- Fix handle_new_user trigger: brand plan keys, no invite logic
-- Invite flow will be rebuilt separately (register first, then join)
-- ==========================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  acct_type    text;
  plan_key_val text;
BEGIN
  acct_type    := NEW.raw_user_meta_data->>'account_type';
  plan_key_val := CASE acct_type
    WHEN 'student'  THEN 'base'
    WHEN 'educator' THEN 'lite'
    WHEN 'manager'  THEN 'launch'
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
