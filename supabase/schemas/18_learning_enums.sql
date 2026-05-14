-- ==========================================
-- ENUMS: learning platform
-- Depends on: nothing
-- ==========================================

CREATE TYPE question_type AS ENUM ('mcq', 'true_false', 'open');
CREATE TYPE question_difficulty AS ENUM ('easy', 'medium', 'hard');
