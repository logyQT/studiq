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
