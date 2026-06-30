-- ==========================================
-- ENUMS
-- Must be created before any table that references them.
-- ==========================================

CREATE TYPE user_role AS ENUM ('free', 'premium', 'student', 'teacher', 'university_admin', 'sys_admin');
-- plan_type and sub_status enums were removed along with subscription tables
-- (plan_type: 'basic', 'pro', 'enterprise'; sub_status: 'active', 'past_due', 'expired', 'canceled')
