-- flashcard_review_state.interval_days is a magnitude whose unit depends on the
-- learning phase (learning/relearning steps are minutes, review intervals are days).
-- Record the unit so 1 minute and 1 day can never collapse into the same value.
ALTER TABLE public.flashcard_review_state
  ADD COLUMN interval_unit text NOT NULL DEFAULT 'days'
  CHECK (interval_unit IN ('minutes', 'days'));

-- Every existing row was written by the calculator, so the unit is a pure
-- function of learning_state. Backfilling by state is exact, not a guess.
UPDATE public.flashcard_review_state
SET interval_unit = 'minutes'
WHERE learning_state IN ('learning', 'relearning');

COMMENT ON COLUMN public.flashcard_review_state.interval_days IS
  'Interval magnitude in interval_unit: minutes for learning/relearning steps, days for review intervals';
COMMENT ON COLUMN public.flashcard_review_state.interval_unit IS
  'Unit of interval_days: minutes (learning steps) or days (review intervals)';
