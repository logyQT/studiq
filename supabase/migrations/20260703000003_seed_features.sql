-- ==========================================
-- SEED: Feature Flags, Plans, Plan Features
-- Must run after feature_flags, subscription_plans,
-- and plan_features tables exist.
-- ==========================================

-- ==========================================
-- FEATURE FLAGS
-- ==========================================
-- Keys use the canonical flat form (see src/server/services/plan.resolver.ts).
INSERT INTO public.feature_flags (key, name, description, is_enabled, rollout_percentage) VALUES
  ('flashcards', 'Flashcards', 'Create, organize, and study flashcards with spaced repetition', true, 100),
  ('quiz', 'Quizzes', 'Create and take quizzes', true, 100),
  ('ai.chat', 'AI Assistant', 'AI-powered chat, flashcard generation, and explanations', true, 100),
  ('quiz.builder', 'Quiz Builder', 'Create and manage quizzes as a teacher', true, 100),
  ('documents', 'Documents', 'Upload and manage documents (coming soon)', true, 100),
  ('org.manage', 'Organization Management', 'Manage members, invitations, and org settings', true, 100),
  ('advanced.stats', 'Advanced Statistics', 'Detailed learning analytics and trend charts', true, 100)
ON CONFLICT DO NOTHING;

-- ==========================================
-- SUBSCRIPTION PLANS
-- ==========================================
INSERT INTO public.subscription_plans (key, name, description, price_monthly, sort_order) VALUES
  ('free', 'Free', 'Basic flashcards and quizzes', 0, 1),
  ('premium', 'Premium', 'AI Assistant, advanced stats, and more', 999, 2),
  ('school', 'School', 'Full platform features for educational institutions', 0, 3),
  ('sysadmin', 'System Admin', 'Internal — all features', 0, 99)
ON CONFLICT DO NOTHING;

-- ==========================================
-- PLAN FEATURES
-- ==========================================
INSERT INTO public.plan_features (plan_key, feature_key) VALUES
  -- Free tier
  ('free', 'flashcards'),
  ('free', 'quiz'),
  -- Premium tier
  ('premium', 'flashcards'),
  ('premium', 'quiz'),
  ('premium', 'ai.chat'),
  ('premium', 'advanced.stats'),
  -- School tier
  ('school', 'flashcards'),
  ('school', 'quiz'),
  ('school', 'ai.chat'),
  ('school', 'quiz.builder'),
  ('school', 'documents'),
  ('school', 'org.manage'),
  ('school', 'advanced.stats'),
  -- Sysadmin (internal)
  ('sysadmin', 'flashcards'),
  ('sysadmin', 'quiz'),
  ('sysadmin', 'ai.chat'),
  ('sysadmin', 'quiz.builder'),
  ('sysadmin', 'documents'),
  ('sysadmin', 'org.manage'),
  ('sysadmin', 'advanced.stats')
ON CONFLICT DO NOTHING;

