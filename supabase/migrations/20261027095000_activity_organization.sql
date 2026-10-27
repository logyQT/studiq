-- ==========================================
-- Organization scope of learner activity (#654 review, operator decision A2)
--
-- `quiz_attempts` and `flashcard_practice` had no organization, so every aggregate over a
-- learner's activity mixed the organizations the learner belongs to: switching into UE showed
-- activity from WSB. This stamps each row with the organization that OWNS the thing practised,
-- not the organization the caller happened to have active:
--
--   * assignment attempt            -> the assignment's organization;
--   * practice quiz                 -> the organization of its questions, when they all share
--                                      one and are shared into a group (set once the attempt
--                                      snapshot `quiz_attempt_questions` exists);
--   * flashcard review              -> the organization of the flashcard, when it is shared
--                                      into a group.
--
-- Personal resources (visibility = 'personal') stay NULL, and a NULL row is part of no
-- organization aggregate. Stamping is done by triggers, so every write path (the services, SQL,
-- seeds) is covered and none can forget it. Existing rows are backfilled by the same rules;
-- what cannot be attributed stays NULL.
-- ==========================================

ALTER TABLE public.quiz_attempts
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

ALTER TABLE public.flashcard_practice
  ADD COLUMN IF NOT EXISTS organization_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quiz_attempts_organization
  ON public.quiz_attempts(organization_id, completed_at)
  WHERE organization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_flashcard_practice_organization
  ON public.flashcard_practice(organization_id, practiced_at)
  WHERE organization_id IS NOT NULL;

-- ==========================================
-- Backfill
-- ==========================================
UPDATE public.quiz_attempts qa
SET organization_id = ta.organization_id
FROM public.teacher_assignments ta
WHERE qa.assignment_id = ta.id
  AND qa.organization_id IS NULL;

-- Practice quizzes: only when every question of the attempt sits in one organization and is
-- shared into a group.
UPDATE public.quiz_attempts qa
SET organization_id = s.organization_id
FROM (
  SELECT aq.attempt_id, MIN(q.organization_id::text)::uuid AS organization_id
  FROM public.quiz_attempt_questions aq
  JOIN public.questions q ON q.id = aq.question_id
  GROUP BY aq.attempt_id
  HAVING COUNT(DISTINCT q.organization_id) = 1
     AND COUNT(*) FILTER (WHERE q.organization_id IS NULL OR q.visibility <> 'group') = 0
) s
WHERE qa.id = s.attempt_id
  AND qa.assignment_id IS NULL
  AND qa.organization_id IS NULL;

UPDATE public.flashcard_practice fp
SET organization_id = f.organization_id
FROM public.flashcards f
WHERE fp.flashcard_id = f.id
  AND f.visibility = 'group'
  AND fp.organization_id IS NULL;

-- ==========================================
-- Stamping triggers. SECURITY DEFINER: the learner who writes the row may not be allowed to
-- read the owning teacher's resource through RLS, and the stamp must not depend on that.
-- ==========================================
CREATE OR REPLACE FUNCTION public.stamp_quiz_attempt_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.organization_id IS NULL AND NEW.assignment_id IS NOT NULL THEN
    SELECT ta.organization_id INTO NEW.organization_id
    FROM public.teacher_assignments ta
    WHERE ta.id = NEW.assignment_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quiz_attempts_stamp_organization ON public.quiz_attempts;
CREATE TRIGGER quiz_attempts_stamp_organization
  BEFORE INSERT ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_quiz_attempt_organization();

-- A practice quiz is created first and its questions are snapshotted after: the organization is
-- set when the snapshot lands (statement level, one pass per insert, however many questions).
CREATE OR REPLACE FUNCTION public.stamp_practice_attempt_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.quiz_attempts qa
  SET organization_id = s.organization_id
  FROM (
    SELECT aq.attempt_id, MIN(q.organization_id::text)::uuid AS organization_id
    FROM public.quiz_attempt_questions aq
    JOIN public.questions q ON q.id = aq.question_id
    WHERE aq.attempt_id IN (SELECT DISTINCT attempt_id FROM new_rows)
    GROUP BY aq.attempt_id
    HAVING COUNT(DISTINCT q.organization_id) = 1
       AND COUNT(*) FILTER (WHERE q.organization_id IS NULL OR q.visibility <> 'group') = 0
  ) s
  WHERE qa.id = s.attempt_id
    AND qa.assignment_id IS NULL
    AND qa.organization_id IS NULL;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS quiz_attempt_questions_stamp_organization ON public.quiz_attempt_questions;
CREATE TRIGGER quiz_attempt_questions_stamp_organization
  AFTER INSERT ON public.quiz_attempt_questions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.stamp_practice_attempt_organization();

CREATE OR REPLACE FUNCTION public.stamp_flashcard_practice_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NEW.organization_id IS NULL THEN
    SELECT f.organization_id INTO NEW.organization_id
    FROM public.flashcards f
    WHERE f.id = NEW.flashcard_id
      AND f.visibility = 'group';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS flashcard_practice_stamp_organization ON public.flashcard_practice;
CREATE TRIGGER flashcard_practice_stamp_organization
  BEFORE INSERT ON public.flashcard_practice
  FOR EACH ROW EXECUTE FUNCTION public.stamp_flashcard_practice_organization();

REVOKE ALL ON FUNCTION public.stamp_quiz_attempt_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_practice_attempt_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_flashcard_practice_organization() FROM PUBLIC, anon, authenticated;
