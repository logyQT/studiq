-- ==========================================
-- TABLE: user_subscriptions
-- Depends on: _enums.sql, profiles.sql
-- Managed via Stripe webhooks.
-- ==========================================

CREATE TABLE public.user_subscriptions (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id     text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan_status            sub_status DEFAULT 'active',
  ends_at                timestamptz
);

-- ==========================================
-- RPC: upgrade_user_to_premium
-- Called by the Stripe webhook handler (service role).
-- Upserts the subscription row and elevates the profile
-- role to 'premium' — but only if the user is still 'free'
-- (prevents accidentally downgrading admins/teachers).
-- ==========================================

CREATE OR REPLACE FUNCTION public.upgrade_user_to_premium(
  p_user_id      uuid,
  p_stripe_cust_id text,
  p_stripe_sub_id  text,
  p_ends_at        timestamptz
) RETURNS void AS $$
BEGIN
  INSERT INTO public.user_subscriptions
    (user_id, stripe_customer_id, stripe_subscription_id, plan_status, ends_at)
  VALUES
    (p_user_id, p_stripe_cust_id, p_stripe_sub_id, 'active', p_ends_at)
  ON CONFLICT (stripe_subscription_id)
  DO UPDATE SET
    plan_status = 'active',
    ends_at     = EXCLUDED.ends_at;

  -- Only elevate free users; leave admins / teachers untouched
  UPDATE public.profiles
    SET role = 'premium'
    WHERE id = p_user_id AND role = 'free';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- RLS
-- ==========================================

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;