-- ==========================================
-- ENUMS
-- Must be created before any table that references them.
-- ==========================================

CREATE TYPE account_type AS ENUM ('student', 'educator', 'manager');
CREATE TYPE question_type AS ENUM ('mcq', 'true_false', 'open');
CREATE TYPE visibility_type AS ENUM ('personal', 'group');
CREATE TYPE assignment_status AS ENUM ('draft', 'published');