-- ==========================================
-- Item versioning (#1171 slice 1)
-- `questions.version` is a content change counter: a content/explanation edit, or any option
-- change, bumps it in the database — so a direct PostgREST write by the author moves it too.
-- Depends on: 24_questions.sql, 27_question_options.sql
-- ==========================================

CREATE OR REPLACE FUNCTION public.bump_question_version()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.version := OLD.version + 1;
  RETURN NEW;
END;
$$;

CREATE TRIGGER questions_bump_version
  BEFORE UPDATE OF content, explanation ON public.questions
  FOR EACH ROW
  WHEN (
    NEW.content IS DISTINCT FROM OLD.content
    OR NEW.explanation IS DISTINCT FROM OLD.explanation
  )
  EXECUTE FUNCTION public.bump_question_version();

CREATE OR REPLACE FUNCTION public.bump_question_version_on_option()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  question uuid := COALESCE(NEW.question_id, OLD.question_id);
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.question_id IS NOT DISTINCT FROM OLD.question_id
     AND NEW.content IS NOT DISTINCT FROM OLD.content
     AND NEW.order_index IS NOT DISTINCT FROM OLD.order_index
     AND NEW.is_correct IS NOT DISTINCT FROM OLD.is_correct
     AND NEW.match_group IS NOT DISTINCT FROM OLD.match_group
     AND NEW.match_side IS NOT DISTINCT FROM OLD.match_side THEN
    RETURN NULL;
  END IF;

  IF question IS NOT NULL THEN
    UPDATE public.questions SET version = version + 1 WHERE id = question;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER question_options_bump_version
  AFTER INSERT OR UPDATE OR DELETE ON public.question_options
  FOR EACH ROW EXECUTE FUNCTION public.bump_question_version_on_option();
