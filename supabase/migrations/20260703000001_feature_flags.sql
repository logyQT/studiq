-- ==========================================
-- MIGRATION: Feature Flags + Subscription Plans
-- Phase 1: Org-centric access control foundation
-- ==========================================

-- ==========================================
-- TABLE: feature_flags
-- Global feature definitions. isEnabled controls kill switch.
-- rollout_percentage enables gradual rollout (0-100).
-- ==========================================
CREATE TABLE public.feature_flags (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key               text UNIQUE NOT NULL,
  name              text NOT NULL,
  description       text,
  is_enabled        boolean DEFAULT true,
  rollout_percentage int DEFAULT 100 CHECK (rollout_percentage BETWEEN 0 AND 100),
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

-- ==========================================
-- TABLE: subscription_plans
-- Available plans. key mirrors user_role values for Phase 1 bridge.
-- In Phase 2+, plans are assigned to organizations, not users.
-- ==========================================
CREATE TABLE public.subscription_plans (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key            text UNIQUE NOT NULL,
  name           text NOT NULL,
  description    text,
  price_monthly  int DEFAULT 0,
  price_yearly   int DEFAULT 0,
  sort_order     int DEFAULT 0,
  is_active      boolean DEFAULT true,
  created_at     timestamptz DEFAULT now(),
  updated_at     timestamptz DEFAULT now()
);

-- ==========================================
-- TABLE: plan_features
-- Junction: which features each plan includes.
-- Enforced by requireFeature() in src/lib/features.ts.
-- ==========================================
CREATE TABLE public.plan_features (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_key    text NOT NULL REFERENCES public.subscription_plans(key) ON DELETE CASCADE,
  feature_key text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  UNIQUE(plan_key, feature_key)
);

-- ==========================================
-- TABLE: user_feature_overrides
-- Per-user overrides for trials, comp accounts, bug reports, etc.
-- Takes priority over plan_features in requireFeature().
-- ==========================================
CREATE TABLE public.user_feature_overrides (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  feature_key  text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  is_enabled   boolean NOT NULL,
  reason       text,
  expires_at   timestamptz,
  created_by   uuid REFERENCES public.profiles(id),
  created_at   timestamptz DEFAULT now(),
  UNIQUE(user_id, feature_key)
);

-- ==========================================
-- TABLE: feature_permissions
-- DOCUMENTATION ONLY — NOT ENFORCED.
-- Maps each feature to the atomic permissions it includes.
-- Used by admin UI for discovery and by frontend for auto-hiding elements.
-- ==========================================
CREATE TABLE public.feature_permissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  feature_key      text NOT NULL REFERENCES public.feature_flags(key) ON DELETE CASCADE,
  permission_name  text NOT NULL REFERENCES public.permissions(name) ON DELETE CASCADE,
  created_at       timestamptz DEFAULT now(),
  UNIQUE(feature_key, permission_name)
);

CREATE INDEX idx_user_feature_overrides_user ON public.user_feature_overrides(user_id);
CREATE INDEX idx_feature_permissions_feature ON public.feature_permissions(feature_key);
