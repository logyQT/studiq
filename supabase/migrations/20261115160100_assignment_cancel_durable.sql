-- ==========================================
-- Cancel is durable (#1174, R12/R19)
--
-- `closed_at` is already once-only (20261114160000_assessment_close.sql). The cancel state needs the
-- same guarantee: a cancelled run must not be flipped back to `published` by a later edit, a
-- re-publish or a hand-written update, because its items were released and its attempts expired —
-- reviving it would serve an assessment whose first attempt already happened.
--
-- The seal and the student paths already filter `status = 'published'`, so a cancelled row is
-- invisible to students (404) and holds nothing. This trigger is the boundary that keeps it that
-- way, the same way the close-once trigger keeps a closed run closed.
-- ==========================================

CREATE OR REPLACE FUNCTION public.teacher_assignments_cancel_once()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.status = 'cancelled' AND NEW.status IS DISTINCT FROM 'cancelled' THEN
    RAISE EXCEPTION 'teacher_assignments.status is terminal once cancelled: a cancelled assessment cannot be revived'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teacher_assignments_cancel_once ON public.teacher_assignments;

CREATE TRIGGER trg_teacher_assignments_cancel_once
  BEFORE UPDATE ON public.teacher_assignments
  FOR EACH ROW EXECUTE FUNCTION public.teacher_assignments_cancel_once();
