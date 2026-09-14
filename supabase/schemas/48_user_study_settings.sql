-- ==========================================
-- TABLE: user_study_settings
-- Per-user flashcard study preferences and daily caps.
-- Depends on: 04_profiles.sql
-- ==========================================

CREATE TABLE public.user_study_settings (
  user_id              uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  learning_steps       integer[] NOT NULL DEFAULT '{1,10}',
  -- Array of minute durations. learning_step indexes into this.
  -- Default: step 0 = 1 min, step 1 = 10 min, then graduate to 'review'.
  new_cards_per_day    integer NOT NULL DEFAULT 20,
  daily_review_goal    integer NOT NULL DEFAULT 0,
  leech_threshold      integer NOT NULL DEFAULT 8,
  new_cards_introduced integer NOT NULL DEFAULT 0,
  daily_reset_date     date NOT NULL DEFAULT CURRENT_DATE
);

COMMENT ON TABLE public.user_study_settings IS 'Per-user flashcard study preferences and daily new-card budget';
COMMENT ON COLUMN public.user_study_settings.learning_steps IS 'Minute durations per learning step. Indexed by flashcard_review_state.learning_step. Graduate after last step.';
COMMENT ON COLUMN public.user_study_settings.new_cards_per_day IS 'Maximum new cards to introduce per day';
COMMENT ON COLUMN public.user_study_settings.daily_review_goal IS 'Target number of review cards per day';
COMMENT ON COLUMN public.user_study_settings.leech_threshold IS 'lapse_count >= this -> card flagged as leech';
COMMENT ON COLUMN public.user_study_settings.new_cards_introduced IS 'Count of new cards introduced today (reset to 0 when daily_reset_date < current_date)';
COMMENT ON COLUMN public.user_study_settings.daily_reset_date IS 'Last date new_cards_introduced was reset';
