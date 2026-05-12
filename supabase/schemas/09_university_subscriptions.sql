-- ==========================================
-- TABLE: university_subscriptions
-- Depends on: _enums.sql, universities.sql
-- Managed by sys_admins (not Stripe).
-- ==========================================

CREATE TABLE public.university_subscriptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  plan_type     plan_type  DEFAULT 'basic',
  status        sub_status DEFAULT 'active',
  ends_at       timestamptz,
  updated_at    timestamptz DEFAULT now()
);
