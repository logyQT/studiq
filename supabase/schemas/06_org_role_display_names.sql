-- ==========================================
-- TABLE: org_role_display_names
-- Per-organization display names for roles
-- (e.g., "Assistant" instead of "teacher").
-- Depends on: 00_enums.sql, 03_organizations.sql
-- ==========================================

CREATE TABLE public.org_role_display_names (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            user_role NOT NULL,
  display_name    text NOT NULL,
  UNIQUE(organization_id, role)
);

CREATE INDEX idx_org_role_display_names_org ON public.org_role_display_names(organization_id);
