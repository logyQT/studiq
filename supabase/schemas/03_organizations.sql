-- ==========================================
-- TABLE: organizations
-- Supports sub-orgs via parent_id (arbitrary depth).
-- Depends on: _enums.sql
-- ==========================================

CREATE TABLE public.organizations (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  created_at  timestamptz DEFAULT now(),
  plan        text NOT NULL DEFAULT 'free'::text REFERENCES subscription_plans(key),
  logo_url    text,
  brand_color text
);