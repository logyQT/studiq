-- Disable RLS + drop policies on user_study_settings
DROP POLICY IF EXISTS "Users can manage own settings" ON public.user_study_settings;
DROP POLICY IF EXISTS "Service role full access" ON public.user_study_settings;
ALTER TABLE public.user_study_settings DISABLE ROW LEVEL SECURITY;

-- Disable RLS + drop policies on flashcard_study_sessions
DROP POLICY IF EXISTS "Users can insert their own sessions" ON public.flashcard_study_sessions;
DROP POLICY IF EXISTS "Users can view their own sessions" ON public.flashcard_study_sessions;
ALTER TABLE public.flashcard_study_sessions DISABLE ROW LEVEL SECURITY;

-- Grant suspended_decks to the roles Supabase Data API uses
GRANT ALL PRIVILEGES ON TABLE public.suspended_decks TO authenticated, service_role;
