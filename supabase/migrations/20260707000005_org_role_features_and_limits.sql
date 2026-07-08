-- ==========================================
-- MIGRATION: org_role_features + org_limits
-- Phase 1: Org-flexible features and limits
-- ==========================================

-- ==========================================
-- TABLE: org_role_features
-- Per-role feature toggles within an org.
-- Seeded by handle_new_organization trigger.
-- Overrides plan_features lookup when present.
-- ==========================================
CREATE TABLE public.org_role_features (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_role_id     uuid NOT NULL REFERENCES public.org_roles(id) ON DELETE CASCADE,
  feature_key     text NOT NULL,
  is_enabled      boolean NOT NULL DEFAULT true,
  UNIQUE(org_role_id, feature_key)
);

CREATE INDEX idx_orf_role ON public.org_role_features(org_role_id);

-- ==========================================
-- TABLE: org_limits
-- Per-org capacity caps (org-wide limits).
-- Seeded by handle_new_organization trigger.
-- Enforced via live COUNT(*) queries.
-- ==========================================
CREATE TABLE public.org_limits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  limit_key       text NOT NULL,
  max_value       integer NOT NULL,
  UNIQUE(organization_id, limit_key)
);

CREATE INDEX idx_ol_org ON public.org_limits(organization_id);

-- ==========================================
-- RLS
-- ==========================================
ALTER TABLE public.org_role_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_limits ENABLE ROW LEVEL SECURITY;
