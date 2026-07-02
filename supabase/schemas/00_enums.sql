-- ==========================================
-- ENUMS
-- Must be created before any table that references them.
-- ==========================================

CREATE TYPE user_role AS ENUM ('free', 'premium', 'student', 'teacher', 'university_admin', 'sys_admin');
CREATE TYPE question_type AS ENUM ('mcq', 'true_false', 'open');
-- CREATE TYPE question_difficulty AS ENUM ('easy', 'medium', 'hard');
-- Deprecated (tables dropped, enums kept for existing data):
-- plan_type: 'basic', 'pro', 'enterprise'
-- sub_status: 'active', 'past_due', 'expired', 'canceled'
