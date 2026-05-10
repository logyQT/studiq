-- ==========================================
-- 1. ENUMS
-- ==========================================
CREATE TYPE user_role AS ENUM ('free', 'premium', 'student', 'teacher', 'university_admin', 'sys_admin');
CREATE TYPE plan_type AS ENUM ('basic', 'pro', 'enterprise');
CREATE TYPE sub_status AS ENUM ('active', 'past_due', 'expired', 'canceled');

-- ==========================================
-- 2. TABLES (Ordered to prevent FK errors)
-- ==========================================

-- Base Institutional Table
CREATE TABLE public.universities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Profiles (Extends auth.users)
CREATE TABLE public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text UNIQUE NOT NULL,
  full_name text,
  role user_role DEFAULT 'free',
  university_id uuid REFERENCES public.universities(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

-- Invitations
CREATE TABLE public.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  token text UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(16), 'hex'),
  target_role user_role NOT NULL,
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  inviter_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  is_accepted boolean DEFAULT false,
  expires_at timestamptz NOT NULL
);

-- University Subscriptions (Managed by Sys Admins)
CREATE TABLE public.university_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid REFERENCES public.universities(id) ON DELETE CASCADE,
  plan_type plan_type DEFAULT 'basic',
  status sub_status DEFAULT 'active',
  ends_at timestamptz,
  updated_at timestamptz DEFAULT now()
);

-- User Subscriptions (Managed via Stripe)
CREATE TABLE public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_subscription_id text UNIQUE,
  plan_status sub_status DEFAULT 'active',
  ends_at timestamptz
);

-- ==========================================
-- 3. FUNCTIONS & TRIGGERS
-- ==========================================

-- A. Auto-create profile & Handle Invitations atomically on Signup
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER AS $$
DECLARE
  passed_token text := NEW.raw_user_meta_data->>'invite_token';
  invite_record record;
BEGIN
  -- If user signed up with an invite token
  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record FROM public.invitations 
    WHERE token = passed_token AND is_accepted = false AND expires_at > now();
    
    IF FOUND THEN
      -- Create profile with elevated privileges linked to the university
      INSERT INTO public.profiles (id, email, full_name, role, university_id)
      VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', invite_record.target_role, invite_record.university_id);
      
      -- Mark invite accepted atomically
      UPDATE public.invitations SET is_accepted = true WHERE id = invite_record.id;
      
      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: standard free signup
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', 'free');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach the trigger to auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- C. RPC: Upgrade to Premium (Called by Stripe Webhook)
CREATE OR REPLACE FUNCTION public.upgrade_user_to_premium(
  p_user_id uuid,
  p_stripe_cust_id text,
  p_stripe_sub_id text,
  p_ends_at timestamptz
) RETURNS void AS $$
BEGIN
  -- 1. Upsert Subscription
  INSERT INTO public.user_subscriptions (user_id, stripe_customer_id, stripe_subscription_id, plan_status, ends_at)
  VALUES (p_user_id, p_stripe_cust_id, p_stripe_sub_id, 'active', p_ends_at)
  ON CONFLICT (stripe_subscription_id) 
  DO UPDATE SET plan_status = 'active', ends_at = EXCLUDED.ends_at;

  -- 2. Elevate Profile Role (Only if they are currently a free user)
  UPDATE public.profiles SET role = 'premium' WHERE id = p_user_id AND role = 'free';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- D. RPC: Admin Change Role
CREATE OR REPLACE FUNCTION public.admin_change_role(p_target_user uuid, p_new_role user_role) 
RETURNS void AS $$
BEGIN
  -- Security check: Ensure caller is an admin (Runs as Postgres via Security Definer, so we check auth.uid())
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role IN ('university_admin', 'sys_admin')) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an administrator.';
  END IF;

  UPDATE public.profiles SET role = p_new_role WHERE id = p_target_user;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ==========================================
-- 4. ROW LEVEL SECURITY (RLS)
-- ==========================================

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.universities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.university_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

-- Profiles: Users can read and update their own profile
CREATE POLICY "Users can view own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Universities: Public read (needed for slugs/signup forms)
CREATE POLICY "Public university read" ON public.universities FOR SELECT USING (true);

-- Invitations: Anyone can query by token (needed for the public accept-invite page)
CREATE POLICY "Read invite by token" ON public.invitations FOR SELECT USING (true); 

-- User Subs: Read own subscription
CREATE POLICY "Read own subscription" ON public.user_subscriptions FOR SELECT USING (auth.uid() = user_id);

-- University Subs: Read if you belong to the university
CREATE POLICY "Read university subscription" ON public.university_subscriptions FOR SELECT 
USING (
  university_id IN (
    SELECT university_id FROM public.profiles WHERE id = auth.uid()
  )
);

-- 1. Pozwalamy sys_adminom tworzyć nowe uczelnie
CREATE POLICY "Sys admins can insert universities" 
ON public.universities 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role = 'sys_admin'
  )
);

-- 2. Proaktywnie: Pozwalamy adminom uczelni generować zaproszenia, 
-- żebyś nie dostał zaraz tego samego błędu na drugim endpoincie!
CREATE POLICY "University admins can insert invitations" 
ON public.invitations 
FOR INSERT 
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.profiles 
    WHERE id = auth.uid() AND role IN ('university_admin', 'sys_admin')
  )
);

CREATE OR REPLACE FUNCTION public.sync_profile_role_to_auth()
RETURNS TRIGGER AS $$
BEGIN
  -- Aktualizujemy tabelę auth.users
  -- Używamy operatora || aby połączyć obecne metadane z nową rolą
  UPDATE auth.users
  SET raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || 
      jsonb_build_object('role', NEW.role)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Usuwamy stary trigger, jeśli istniał, żeby uniknąć konfliktów
DROP TRIGGER IF EXISTS on_profile_role_update ON public.profiles;

CREATE TRIGGER on_profile_role_update
  AFTER INSERT OR UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_role_to_auth();