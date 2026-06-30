-- ==========================================
-- TABLE: org_subscriptions
-- Depends on: _enums.sql, organizations.sql
-- Managed by sys_admins (not Stripe).
-- ==========================================

CREATE TABLE public.org_subscriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan_type       plan_type  DEFAULT 'basic',
  status          sub_status DEFAULT 'active',
  ends_at         timestamptz,
  updated_at      timestamptz DEFAULT now()
);
