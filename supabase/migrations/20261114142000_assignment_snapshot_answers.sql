-- An assignment answer points at the published option, not the live row (#1171, slice 1b-ii).
-- The author edit path replaces options (delete + insert); `ON DELETE SET NULL` would null or
-- block an answer taken against the published option set. The submit gate validates the option
-- against the attempt's own snapshot, which the FK never did.

ALTER TABLE public.student_answers
  DROP CONSTRAINT IF EXISTS student_answers_selected_option_id_fkey;
