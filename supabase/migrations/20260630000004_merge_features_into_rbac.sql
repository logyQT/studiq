-- ==========================================
-- Migration: Merge features into RBAC
-- 
-- 1. Add 'granted' scope to role_permissions
-- 2. Insert feature keys as permissions
-- 3. Assign feature permissions to roles
-- 4. Drop deprecated subscription/feature tables
-- ==========================================

-- ==========================================
-- STEP 1: Add 'granted' scope
-- ==========================================
ALTER TABLE public.role_permissions
  DROP CONSTRAINT IF EXISTS role_permissions_scope_check;

ALTER TABLE public.role_permissions
  ADD CONSTRAINT role_permissions_scope_check
  CHECK (scope IN ('own', 'university', 'any', 'granted'));

-- ==========================================
-- STEP 2: Insert feature permissions
-- ==========================================
INSERT INTO public.permissions (name) VALUES
  ('study.create'),
  ('study.participate'),
  ('test.create'),
  ('test.participate'),
  ('ai.chat'),
  ('org.manage')
ON CONFLICT DO NOTHING;

-- ==========================================
-- STEP 3: Assign feature permissions to roles
-- ==========================================

-- free: can participate only
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'free', p.id, 'granted'
FROM public.permissions p
WHERE p.name IN ('study.participate', 'test.participate')
ON CONFLICT DO NOTHING;

-- premium: individual create + participate + ai
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'premium', p.id,
  CASE
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat') THEN 'granted'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN ('study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat')
ON CONFLICT DO NOTHING;

-- student: own create + participate
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'student', p.id,
  CASE
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat') THEN 'granted'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN ('study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat')
ON CONFLICT DO NOTHING;

-- teacher: university create + participate + ai + org
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'teacher', p.id,
  CASE
    WHEN p.name IN ('study.create', 'test.create') THEN 'university'
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat', 'org.manage') THEN 'granted'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN ('study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage')
ON CONFLICT DO NOTHING;

-- university_admin: own create + university read/update/delete + org manage
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'university_admin', p.id,
  CASE
    WHEN p.name IN ('study.create', 'test.create') THEN 'own'
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat', 'org.manage') THEN 'granted'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN ('study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage')
ON CONFLICT DO NOTHING;

-- sys_admin: all any
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'sys_admin', p.id, 'any'
FROM public.permissions p
WHERE p.name IN ('study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage')
ON CONFLICT DO NOTHING;

-- ==========================================
-- STEP 4: Drop deprecated tables
-- ==========================================

-- Drop plan_features first (FK to features + subscription_plans)
DROP TABLE IF EXISTS public.plan_features CASCADE;

-- Drop features (no longer needed as separate table)
DROP TABLE IF EXISTS public.features CASCADE;

-- Drop subscription_plans
DROP TABLE IF EXISTS public.subscription_plans CASCADE;

-- Drop plan_id column from user_subscriptions (added in previous migration)
ALTER TABLE public.user_subscriptions DROP COLUMN IF EXISTS plan_id;

-- Drop user_subscriptions table
DROP TABLE IF EXISTS public.user_subscriptions CASCADE;

-- Drop org_subscriptions table
DROP TABLE IF EXISTS public.org_subscriptions CASCADE;

-- ==========================================
-- STEP 5: Clean up deprecated RPC
-- ==========================================
DROP FUNCTION IF EXISTS public.upgrade_user_to_premium CASCADE;

-- ==========================================
-- STEP 6: Revoke/cleanup RLS policies on dropped tables
-- (handled by CASCADE above)
-- ==========================================
