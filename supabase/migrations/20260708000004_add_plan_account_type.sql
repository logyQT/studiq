-- ==========================================================
-- Add for_account_type column to subscription_plans
-- Enables filtering plans by account type on the pricing page
-- ==========================================================

ALTER TABLE public.subscription_plans
  ADD COLUMN for_account_type text;
