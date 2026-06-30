-- ==========================================
-- TABLE: organizations
-- Depends on: _enums.sql
-- ==========================================

CREATE TABLE public.organizations (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
