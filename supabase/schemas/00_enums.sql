-- ==========================================
-- ENUMS
-- Must be created before any table that references them.
-- ==========================================

CREATE TYPE user_role AS ENUM ('free', 'premium', 'student', 'teacher', 'university_admin', 'sys_admin');
CREATE TYPE plan_type AS ENUM ('basic', 'pro', 'enterprise');
CREATE TYPE sub_status AS ENUM ('active', 'past_due', 'expired', 'canceled');
