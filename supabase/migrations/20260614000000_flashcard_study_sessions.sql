CREATE TABLE public.flashcard_study_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  duration_ms integer NOT NULL,
  cards_studied integer NOT NULL DEFAULT 0,
  cards_correct integer NOT NULL DEFAULT 0,
  deck_ids uuid[] DEFAULT '{}',
  mode text NOT NULL CHECK (mode IN ('study', 'practice', 'quick')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_flashcard_study_sessions_user ON public.flashcard_study_sessions(user_id);

ALTER TABLE public.flashcard_study_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert their own sessions"
  ON public.flashcard_study_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view their own sessions"
  ON public.flashcard_study_sessions
  FOR SELECT
  USING (auth.uid() = user_id);
