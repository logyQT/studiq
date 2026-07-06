-- ==========================================
-- TABLE: organizations
-- Supports sub-orgs via parent_id (arbitrary depth).
-- Depends on: _enums.sql
-- ==========================================

CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  parent_id  uuid REFERENCES public.organizations(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);
