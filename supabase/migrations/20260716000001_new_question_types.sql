-- ============================================
-- Migration: New Question Types
-- Date: 2026-07-16
--
-- 1. Rename question_answers → question_options
-- 2. Rename quiz_answers → student_answers
-- 3. Extend question_type enum with new types
-- 4. Add type-specific columns
-- 5. Update get_accessible_questions RPC
-- ============================================

BEGIN;

-- ============================================
-- STEP 1: Drop stale RPC overloads
-- ============================================
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid);
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, uuid[], uuid[]);
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text);
DROP FUNCTION IF EXISTS public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text, uuid);

-- ============================================
-- STEP 2: Drop old FK constraints on quiz_answers
-- ============================================
ALTER TABLE IF EXISTS public.quiz_answers
  DROP CONSTRAINT IF EXISTS quiz_answers_attempt_id_fkey,
  DROP CONSTRAINT IF EXISTS quiz_answers_question_id_fkey,
  DROP CONSTRAINT IF EXISTS quiz_answers_selected_answer_id_fkey;

-- ============================================
-- STEP 3: Rename tables
-- ============================================
ALTER TABLE IF EXISTS public.question_answers RENAME TO question_options;
ALTER TABLE IF EXISTS public.quiz_answers RENAME TO student_answers;

-- ============================================
-- STEP 4: Rename indexes
-- ============================================
ALTER INDEX IF EXISTS idx_question_answers_question RENAME TO idx_question_options_question;
ALTER INDEX IF EXISTS idx_quiz_answers_attempt RENAME TO idx_student_answers_attempt;

-- ============================================
-- STEP 5: Rename constraints
-- ============================================
ALTER TABLE public.question_options RENAME CONSTRAINT question_answers_pkey TO question_options_pkey;
ALTER TABLE public.question_options RENAME CONSTRAINT question_answers_question_id_fkey TO question_options_question_id_fkey;
ALTER TABLE public.student_answers RENAME CONSTRAINT quiz_answers_pkey TO student_answers_pkey;

-- ============================================
-- STEP 6: Rename selected_answer_id → selected_option_id
-- ============================================
ALTER TABLE public.student_answers RENAME COLUMN selected_answer_id TO selected_option_id;

-- ============================================
-- STEP 7: Recreate FK constraints on student_answers
-- ============================================
ALTER TABLE public.student_answers
  ADD CONSTRAINT student_answers_attempt_id_fkey
    FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  ADD CONSTRAINT student_answers_question_id_fkey
    FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL,
  ADD CONSTRAINT student_answers_selected_option_id_fkey
    FOREIGN KEY (selected_option_id) REFERENCES public.question_options(id) ON DELETE SET NULL;

-- ============================================
-- STEP 8: Extend question_type enum
--
-- ALTER TYPE ... ADD VALUE cannot run in a transaction,
-- so we recreate the enum entirely.
-- ============================================

-- Remove default and cast to text first
ALTER TABLE public.questions ALTER COLUMN type DROP DEFAULT;
ALTER TABLE public.questions ALTER COLUMN type TYPE text;

-- Drop old type (CASCADE is safe — no other columns use it)
DROP TYPE IF EXISTS question_type CASCADE;

-- Create new enum with all types
CREATE TYPE question_type AS ENUM (
  'mcq',
  'true_false',
  'open',
  'multi_select',
  'matching',
  'ordering',
  'fill_in_blank'
);

-- Cast back to the new enum
ALTER TABLE public.questions
  ALTER COLUMN type TYPE question_type USING type::question_type,
  ALTER COLUMN type SET DEFAULT 'mcq';

-- ============================================
-- STEP 9: Add columns to question_options
-- ============================================
ALTER TABLE public.question_options
  ADD COLUMN IF NOT EXISTS match_group UUID,
  ADD COLUMN IF NOT EXISTS match_side TEXT CHECK (match_side IN ('left', 'right'));

-- ============================================
-- STEP 10: Add columns to student_answers
-- ============================================
ALTER TABLE public.student_answers
  ADD COLUMN IF NOT EXISTS points_earned NUMERIC,
  ADD COLUMN IF NOT EXISTS ai_graded BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS submitted_position INT,
  ADD COLUMN IF NOT EXISTS match_pair_id UUID,
  ADD COLUMN IF NOT EXISTS question_type question_type;

-- ============================================
-- STEP 11: Add time_spent_seconds to quiz_attempt_questions
-- ============================================
ALTER TABLE public.quiz_attempt_questions
  ADD COLUMN IF NOT EXISTS time_spent_seconds INT;

-- ============================================
-- STEP 12: Recreate get_accessible_questions RPC
-- ============================================
CREATE FUNCTION public.get_accessible_questions(
  p_user_id uuid,
  p_org_id uuid DEFAULT NULL,
  p_scope text DEFAULT 'own',
  p_question_id uuid DEFAULT NULL,
  p_bank_ids uuid[] DEFAULT NULL,
  p_topic_ids uuid[] DEFAULT NULL,
  p_type text DEFAULT NULL
)
RETURNS TABLE(
  id uuid, organization_id uuid, created_by uuid,
  type text, content text, explanation text,
  visibility visibility_type, search_vector tsvector,
  created_at timestamptz, updated_at timestamptz,
  question_options jsonb
)
LANGUAGE sql STABLE AS $$
  WITH accessible AS (
    SELECT DISTINCT q.*
    FROM public.questions q
    LEFT JOIN public.question_topic_assignments qta ON qta.question_id = q.id
    LEFT JOIN public.bank_groups bg ON bg.bank_id = q.bank_id
    LEFT JOIN public.topic_groups tg ON tg.topic_id = qta.topic_id
    LEFT JOIN public.group_members gm ON gm.group_id = bg.group_id AND gm.user_id = p_user_id
    WHERE (p_org_id IS NULL OR q.organization_id = p_org_id)
      AND (
        CASE p_scope
          WHEN 'own'   THEN q.created_by = p_user_id
          WHEN 'group' THEN (q.created_by = p_user_id) OR gm.id IS NOT NULL
          ELSE TRUE
        END
      )
      AND (p_bank_ids IS NULL   OR q.bank_id = ANY(p_bank_ids))
      AND (p_topic_ids IS NULL  OR qta.topic_id = ANY(p_topic_ids))
      AND (p_question_id IS NULL OR q.id = p_question_id)
      AND (p_type IS NULL        OR q.type::text = p_type)
  )
  SELECT a.id, a.organization_id, a.created_by, a.type::text, a.content, a.explanation,
         a.visibility, a.search_vector, a.created_at, a.updated_at,
         CASE WHEN p_question_id IS NOT NULL THEN (
           SELECT jsonb_agg(
             jsonb_build_object(
               'id', qo.id,
               'question_id', qo.question_id,
               'content', qo.content,
               'is_correct', qo.is_correct,
               'order_index', qo.order_index,
               'match_group', qo.match_group,
               'match_side', qo.match_side
             ) ORDER BY qo.order_index
           )
           FROM public.question_options qo
           WHERE qo.question_id = a.id
         ) ELSE NULL END AS question_options
  FROM accessible a
  ORDER BY a.created_at DESC;
$$;

COMMIT;
