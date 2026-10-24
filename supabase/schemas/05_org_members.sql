-- ==========================================
-- TABLE: org_members
-- Many-to-many relationship between users and organizations.
-- Each membership links to an org_role which defines permissions.
-- Depends on: 03_organizations.sql, 04_profiles.sql, 56_org_roles.sql
-- ==========================================

CREATE TABLE public.org_members (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  org_role_id     uuid NOT NULL REFERENCES public.org_roles(id),
  joined_at       timestamptz DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

CREATE INDEX idx_org_members_org ON public.org_members(organization_id);
CREATE INDEX idx_org_members_user ON public.org_members(user_id);

-- Group membership ends when organization membership ends (#249). There is no
-- FK between group_members and org_members, so the invariant is enforced by a
-- SECURITY DEFINER trigger on org_members (see
-- 20261024141104_cleanup_group_members_on_org_member_removal.sql).
CREATE OR REPLACE FUNCTION public.cleanup_group_members_on_org_member_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.group_members gm
  USING public.groups g
  WHERE g.id = gm.group_id
    AND g.organization_id = OLD.organization_id
    AND gm.user_id = OLD.user_id;

  RETURN OLD;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_group_members_on_org_member_delete() FROM PUBLIC;

CREATE TRIGGER cleanup_group_members_on_org_member_delete
  AFTER DELETE ON public.org_members
  FOR EACH ROW EXECUTE FUNCTION public.cleanup_group_members_on_org_member_delete();
