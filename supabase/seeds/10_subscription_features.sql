-- ==========================================================
-- Seeds: subscription features (10)
-- Maps subscription_plans to features with allowed_roles
-- ==========================================================

-- Get feature IDs
WITH feature_ids AS (
  SELECT id, key FROM public.features
),
-- Get plan IDs
plan_ids AS (
  SELECT id, name FROM public.subscription_plans
)
INSERT INTO public.plan_features (plan_id, feature_id, allowed_roles)
SELECT
  p.id,
  f.id,
  CASE
    -- 'free' plan: only study participation
    WHEN p.name = 'free' AND f.key = 'study.participate' THEN '{}'::user_role[]
    WHEN p.name = 'free' AND f.key = 'test.participate' THEN '{}'::user_role[]

    -- 'student_premium': individual study creation + participation
    WHEN p.name = 'student_premium' AND f.key = 'study.create' THEN '{}'::user_role[]
    WHEN p.name = 'student_premium' AND f.key = 'study.participate' THEN '{}'::user_role[]
    WHEN p.name = 'student_premium' AND f.key = 'test.participate' THEN '{}'::user_role[]
    WHEN p.name = 'student_premium' AND f.key = 'ai.chat' THEN '{}'::user_role[]

    -- 'teacher_license': teachers can create, students can only participate
    WHEN p.name = 'teacher_license' AND f.key = 'study.create' THEN '{teacher,university_admin}'::user_role[]
    WHEN p.name = 'teacher_license' AND f.key = 'study.participate' THEN '{}'::user_role[]
    WHEN p.name = 'teacher_license' AND f.key = 'test.create' THEN '{teacher,university_admin}'::user_role[]
    WHEN p.name = 'teacher_license' AND f.key = 'test.participate' THEN '{}'::user_role[]
    WHEN p.name = 'teacher_license' AND f.key = 'ai.chat' THEN '{teacher,university_admin}'::user_role[]
    WHEN p.name = 'teacher_license' AND f.key = 'org.manage' THEN '{university_admin}'::user_role[]

    -- 'org_pro': everything unlocked for all roles
    WHEN p.name = 'org_pro' THEN '{}'::user_role[]
  END
FROM plan_ids p
CROSS JOIN feature_ids f
WHERE
  (p.name = 'free' AND f.key IN ('study.participate', 'test.participate'))
  OR (p.name = 'student_premium' AND f.key IN ('study.create', 'study.participate', 'test.participate', 'ai.chat'))
  OR (p.name = 'teacher_license' AND f.key IN ('study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage'))
  OR (p.name = 'org_pro')
ON CONFLICT DO NOTHING;
