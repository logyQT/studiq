-- ==========================================
-- FUNCTIONS + TRIGGERS: organization stamp of learner activity
-- quiz_attempts.organization_id and flashcard_practice.organization_id name the organization
-- that owns what was practised (assignment, shared questions, shared flashcard). Personal
-- resources stay NULL and are part of no organization aggregate. The columns are in
-- 39_quiz_attempts.sql and 45_flashcard_practice.sql; the history lives in
-- migrations/20261028100000_activity_organization.sql.
-- Depends on: 03_organizations.sql, 24_questions.sql, 30_flashcards.sql, 39_quiz_attempts.sql,
--             40_quiz_attempt_questions.sql, 45_flashcard_practice.sql, 62_teacher_assignments.sql
-- ==========================================

-- ==========================================
-- Who is a client. The triggers below are SECURITY DEFINER, so current_user says nothing about the
-- caller; the role of the request does (auth.role()). Direct SQL sessions are trusted.
-- ==========================================
CREATE OR REPLACE FUNCTION public.activity_stamp_client_write()
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  SELECT COALESCE(auth.role(), '') IN ('authenticated', 'anon')
     AND COALESCE(current_setting('studiq.stamping', true), '') <> 'on';
$$;

CREATE OR REPLACE FUNCTION public.stamp_quiz_attempt_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.assignment_id IS DISTINCT FROM OLD.assignment_id THEN
      IF NEW.assignment_id IS NULL THEN
        -- ON DELETE SET NULL: keep the organization the attempt was stamped with.
        NEW.organization_id := OLD.organization_id;
      ELSE
        SELECT ta.organization_id INTO NEW.organization_id
        FROM public.teacher_assignments ta
        WHERE ta.id = NEW.assignment_id;
      END IF;
    ELSIF public.activity_stamp_client_write() THEN
      -- A client can never move the stamp of a row without changing its assignment.
      NEW.organization_id := OLD.organization_id;
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.assignment_id IS NOT NULL THEN
    -- Always the organization of the assignment, whatever the row came with.
    SELECT ta.organization_id INTO NEW.organization_id
    FROM public.teacher_assignments ta
    WHERE ta.id = NEW.assignment_id;
  ELSIF public.activity_stamp_client_write() THEN
    -- A practice quiz is stamped later, from its questions; never from the client.
    NEW.organization_id := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quiz_attempts_stamp_organization
  BEFORE INSERT OR UPDATE OF organization_id, assignment_id ON public.quiz_attempts
  FOR EACH ROW EXECUTE FUNCTION public.stamp_quiz_attempt_organization();

-- A practice quiz is created first and its questions are snapshotted after: the organization is
-- set when the snapshot lands (statement level, one pass per insert, however many questions).
CREATE OR REPLACE FUNCTION public.stamp_practice_attempt_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempts uuid[];
BEGIN
  PERFORM set_config('studiq.stamping', 'on', true);

  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT attempt_id) INTO v_attempts FROM new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT attempt_id) INTO v_attempts FROM old_rows;
  ELSE
    SELECT array_agg(DISTINCT attempt_id) INTO v_attempts
    FROM (
      SELECT attempt_id FROM new_rows
      UNION
      SELECT attempt_id FROM old_rows
    ) affected;
  END IF;

  -- Recompute from the CURRENT snapshot of every affected attempt: a later personal or
  -- foreign question, an updated question, or a removed row makes the set ineligible and
  -- must clear the old stamp. An attempt with no rows left becomes NULL.
  UPDATE public.quiz_attempts qa
  SET organization_id = s.organization_id
  FROM (
    SELECT
      affected.attempt_id,
      CASE
        WHEN COUNT(DISTINCT q.organization_id) = 1
         AND COUNT(*) FILTER (WHERE q.organization_id IS NULL OR q.visibility <> 'group') = 0
        THEN MIN(q.organization_id::text)::uuid
        ELSE NULL
      END AS organization_id
    FROM (SELECT DISTINCT attempt_id FROM unnest(v_attempts) AS attempt_id) affected
    LEFT JOIN public.quiz_attempt_questions aq ON aq.attempt_id = affected.attempt_id
    LEFT JOIN public.questions q ON q.id = aq.question_id
    GROUP BY affected.attempt_id
  ) s
  WHERE qa.id = s.attempt_id
    AND qa.assignment_id IS NULL;

  PERFORM set_config('studiq.stamping', 'off', true);
  RETURN NULL;
END;
$$;

CREATE TRIGGER quiz_attempt_questions_stamp_organization
  AFTER INSERT ON public.quiz_attempt_questions
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.stamp_practice_attempt_organization();

CREATE TRIGGER quiz_attempt_questions_stamp_organization_update
  AFTER UPDATE ON public.quiz_attempt_questions
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.stamp_practice_attempt_organization();

CREATE TRIGGER quiz_attempt_questions_stamp_organization_delete
  AFTER DELETE ON public.quiz_attempt_questions
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.stamp_practice_attempt_organization();

CREATE OR REPLACE FUNCTION public.stamp_flashcard_practice_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.flashcard_id IS DISTINCT FROM OLD.flashcard_id THEN
      SELECT f.organization_id INTO NEW.organization_id
      FROM public.flashcards f
      WHERE f.id = NEW.flashcard_id
        AND f.visibility = 'group';
    ELSIF public.activity_stamp_client_write() THEN
      NEW.organization_id := OLD.organization_id;
    END IF;
    RETURN NEW;
  END IF;

  -- Always the organization of the flashcard (NULL when it is personal), whatever the row came with.
  SELECT f.organization_id INTO NEW.organization_id
  FROM public.flashcards f
  WHERE f.id = NEW.flashcard_id
    AND f.visibility = 'group';
  RETURN NEW;
END;
$$;

CREATE TRIGGER flashcard_practice_stamp_organization
  BEFORE INSERT OR UPDATE OF organization_id, flashcard_id ON public.flashcard_practice
  FOR EACH ROW EXECUTE FUNCTION public.stamp_flashcard_practice_organization();

REVOKE ALL ON FUNCTION public.activity_stamp_client_write() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_quiz_attempt_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_practice_attempt_organization() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stamp_flashcard_practice_organization() FROM PUBLIC, anon, authenticated;
