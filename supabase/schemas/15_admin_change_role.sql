-- ==========================================
-- RPC: admin_change_role
-- Depends on: profiles.sql
-- Can be called by university_admin or sys_admin.
-- Security is enforced inside the function body
-- (auth.uid() check) rather than via RLS, because
-- the function runs as the Postgres superuser
-- (SECURITY DEFINER).
-- ==========================================

CREATE OR REPLACE FUNCTION public.admin_change_role(
  p_target_user uuid,
  p_new_role    user_role
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('university_admin', 'sys_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an administrator.';
  END IF;

  UPDATE public.profiles
    SET role = p_new_role
    WHERE id = p_target_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
