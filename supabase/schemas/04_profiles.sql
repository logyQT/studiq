-- ==========================================
-- TABLE: profiles
-- Depends on: _enums.sql, organizations.sql
-- Extends auth.users (1-to-1 via id FK)
-- ==========================================

CREATE TABLE public.profiles (
  id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         text UNIQUE NOT NULL,
  full_name     text,
  role          user_role DEFAULT 'free',
  organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at    timestamptz DEFAULT now()
);

-- ==========================================
-- TRIGGER: sync role → auth.users app metadata
-- Keeps raw_app_meta_data.role in sync so JWT
-- claims reflect the latest role without a
-- forced token refresh on the client.
-- ==========================================

CREATE FUNCTION public.sync_profile_role_to_auth()
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

CREATE FUNCTION public.sync_profile_org_id_to_auth()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data = 
        coalesce(raw_app_meta_data, '{}'::jsonb) || 
        jsonb_build_object('organization_id', NEW.organization_id)
  WHERE id = NEW.id ;
        
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_org_id_update
  AFTER INSERT OR UPDATE OF organization_id ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_org_id_to_auth();