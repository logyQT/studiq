-- ==========================================
-- MIGRATION: Add plan column to organizations
-- Phase 1: Organizations now have a plan that determines
-- feature access for their members.
-- Phase 2+: Every user will have a personal org with a plan.
-- ==========================================

ALTER TABLE public.organizations
  ADD COLUMN plan text NOT NULL DEFAULT 'free'
  REFERENCES public.subscription_plans(key);
