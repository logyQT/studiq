-- ==========================================
-- TABLE: org_roles
-- Composable, per-organization role definitions.
-- Each org gets default roles on creation (member, teacher, admin).
-- Org managers can create custom roles with any name.
-- Depends on: 03_organizations.sql
-- ==========================================

CREATE TABLE public.org_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_system       boolean DEFAULT false,
  UNIQUE(organization_id, name)
);

CREATE INDEX idx_org_roles_org ON public.org_roles(organization_id);

-- ==========================================
-- TABLE: org_role_permissions
-- Maps each org role to atomic permissions with scopes.
-- Replaces the old global role_permissions table.
-- Depends on: permissions table (see 55_rbac_permissions.sql)
-- ==========================================

CREATE TABLE public.org_role_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_role_id     uuid NOT NULL REFERENCES public.org_roles(id) ON DELETE CASCADE,
  permission_name text NOT NULL,
  scope           text NOT NULL CHECK (scope IN ('own', 'group', 'organization', 'any')),
  UNIQUE(org_role_id, permission_name)
);

CREATE INDEX idx_orp_role ON public.org_role_permissions(org_role_id);

-- ==========================================
-- DEFAULT PERMISSION MATRIX
-- Used by the application layer when seeding roles for a new org.
--
-- Permission          | member     | teacher    | admin
-- --------------------+------------+------------+------------
-- *.read              | orgn.      | orgn.      | orgn.
-- *.create            | own        | orgn.      | orgn.
-- *.update            | own        | orgn.      | orgn.
-- *.delete            | own        | own        | orgn.
-- ai.chat             | —          | granted    | granted
-- org.manage          | —          | granted    | granted
-- ==========================================
