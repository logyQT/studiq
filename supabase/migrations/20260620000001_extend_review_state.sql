-- Extend flashcard_review_state with learning lifecycle columns
-- Drop old last_quality CHECK before adding new columns
ALTER TABLE public.flashcard_review_state
  DROP CONSTRAINT IF EXISTS flashcard_review_state_last_quality_check;

-- Add learning lifecycle columns (defaults preserve existing behavior)
ALTER TABLE public.flashcard_review_state
  ADD COLUMN learning_state   text NOT NULL DEFAULT 'review'
              CHECK (learning_state IN ('new', 'learning', 'review', 'relearning')),
  ADD COLUMN learning_step    integer NOT NULL DEFAULT 0,
  ADD COLUMN lapse_count      integer NOT NULL DEFAULT 0,
  ADD COLUMN is_leech         boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.flashcard_review_state.learning_state IS 'new|learning|review|relearning — learning lifecycle phase';
COMMENT ON COLUMN public.flashcard_review_state.learning_step IS '0-based index into user_study_settings.learning_steps[] (minute durations)';
COMMENT ON COLUMN public.flashcard_review_state.lapse_count IS 'Total wrong answers ever — used for leech detection';
COMMENT ON COLUMN public.flashcard_review_state.is_leech IS 'Flagged as leech — requires user action to un-suspend';

-- Existing rows with nonzero interval already have learning_state = 'review' (default)
