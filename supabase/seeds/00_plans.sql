-- ==========================================================
-- Seed: 00 — Plan system (brand plans + feature flags + limits)
-- Runs BEFORE 01_seed.sql. Replaces migration-seeded plan data.
-- ==========================================================

-- ==========================================================
-- 1. Update column defaults
-- ==========================================================
ALTER TABLE public.profiles ALTER COLUMN personal_plan_key SET DEFAULT 'base';
ALTER TABLE public.organizations ALTER COLUMN plan SET DEFAULT 'launch';

-- ==========================================================
-- 3. Add new feature flags
-- ==========================================================
INSERT INTO public.feature_flags (key, name, description) VALUES
  ('group_manage', 'Group Management', 'Create and manage groups'),
  ('member_manage', 'Member Management', 'Change member roles and remove members'),
  ('role_builder', 'Role Builder', 'Create custom roles with custom permissions')
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 4. Remove old plan data (order matters for FKs)
-- ==========================================================
DELETE FROM public.plan_limits;
DELETE FROM public.plan_features;
DELETE FROM public.subscription_plans;

-- ==========================================================
-- 5. Subscription plans (12 brand plans + sysadmin)
-- Note: `description` column is for admin internal use only.
-- Public-facing descriptions are managed via i18n keys (`plan_{key}_desc`).
-- ==========================================================
INSERT INTO public.subscription_plans (key, name, price_monthly, currency, sort_order, for_account_type) VALUES
  ('base',     'StudiQ Base',    0,     'PLN', 1,    'student'),
  ('lite',     'StudiQ Lite',    0,     'PLN', 2,    'educator'),
  ('launch',   'StudiQ Launch',  0,     'PLN', 3,    'manager'),
  ('spark',    'StudiQ Spark',   999,   'PLN', 4,    'student'),
  ('guide',    'StudiQ Guide',   999,   'PLN', 5,    'educator'),
  ('team',     'StudiQ Team',    999,   'PLN', 6,    'manager'),
  ('ace',      'StudiQ Ace',     1999,  'PLN', 7,    'student'),
  ('creator',  'StudiQ Creator', 1999,  'PLN', 8,    'educator'),
  ('hub',      'StudiQ Hub',     1999,  'PLN', 9,    'manager'),
  ('pro',      'StudiQ Pro',     4999,  'PLN', 10,   'student'),
  ('master',   'StudiQ Master',  4999,  'PLN', 11,   'educator'),
  ('campus',   'StudiQ Campus',  4999,  'PLN', 12,   'manager'),
  ('sysadmin', 'System Admin',   0,     'PLN', 99,   'sys_admin')
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 6. Plan-feature mappings
-- ==========================================================

-- Free tier
INSERT INTO public.plan_features (plan_key, feature_key) VALUES
  ('base', 'flashcards'),
  ('base', 'quiz'),
  ('lite', 'flashcards'),
  ('lite', 'quiz'),
  ('lite', 'group_manage'),
  ('lite', 'member_manage'),
  ('launch', 'flashcards'),
  ('launch', 'quiz'),
  ('launch', 'group_manage'),
  ('launch', 'member_manage'),
  ('launch', 'documents')
ON CONFLICT DO NOTHING;

-- Basic tier
INSERT INTO public.plan_features (plan_key, feature_key) VALUES
  ('spark', 'flashcards'),
  ('spark', 'quiz'),
  ('guide', 'flashcards'),
  ('guide', 'quiz'),
  ('guide', 'quiz_builder'),
  ('guide', 'group_manage'),
  ('guide', 'member_manage'),
  ('team', 'flashcards'),
  ('team', 'quiz'),
  ('team', 'quiz_builder'),
  ('team', 'group_manage'),
  ('team', 'member_manage'),
  ('team', 'documents')
ON CONFLICT DO NOTHING;

-- Premium tier
INSERT INTO public.plan_features (plan_key, feature_key) VALUES
  ('ace', 'flashcards'),
  ('ace', 'quiz'),
  ('ace', 'ai'),
  ('ace', 'advanced_stats'),
  ('creator', 'flashcards'),
  ('creator', 'quiz'),
  ('creator', 'ai'),
  ('creator', 'quiz_builder'),
  ('creator', 'group_manage'),
  ('creator', 'member_manage'),
  ('creator', 'advanced_stats'),
  ('creator', 'documents'),
  ('hub', 'flashcards'),
  ('hub', 'quiz'),
  ('hub', 'ai'),
  ('hub', 'quiz_builder'),
  ('hub', 'group_manage'),
  ('hub', 'member_manage'),
  ('hub', 'role_builder'),
  ('hub', 'advanced_stats'),
  ('hub', 'documents')
ON CONFLICT DO NOTHING;

-- Advanced tier
INSERT INTO public.plan_features (plan_key, feature_key) VALUES
  ('pro', 'flashcards'),
  ('pro', 'quiz'),
  ('pro', 'ai'),
  ('pro', 'advanced_stats'),
  ('pro', 'documents'),
  ('master', 'flashcards'),
  ('master', 'quiz'),
  ('master', 'ai'),
  ('master', 'quiz_builder'),
  ('master', 'group_manage'),
  ('master', 'member_manage'),
  ('master', 'role_builder'),
  ('master', 'advanced_stats'),
  ('master', 'documents'),
  ('campus', 'flashcards'),
  ('campus', 'quiz'),
  ('campus', 'ai'),
  ('campus', 'quiz_builder'),
  ('campus', 'group_manage'),
  ('campus', 'member_manage'),
  ('campus', 'role_builder'),
  ('campus', 'advanced_stats'),
  ('campus', 'documents')
ON CONFLICT DO NOTHING;

-- Sysadmin (everything)
INSERT INTO public.plan_features (plan_key, feature_key)
SELECT 'sysadmin', key FROM public.feature_flags
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 7. Plan limits
-- ==========================================================

-- Free tier — Base (student)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('base', 'max_flashcards', 100),
  ('base', 'max_questions', 50),
  ('base', 'max_decks', 10),
  ('base', 'max_question_banks', 5),
  ('base', 'max_quiz_attempts_per_day', 10),
  ('base', 'max_ai_tokens_per_day', 0),
  ('base', 'max_students', -1),
  ('base', 'max_groups', -1)
ON CONFLICT DO NOTHING;

-- Free tier — Lite (educator)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('lite', 'max_flashcards', 100),
  ('lite', 'max_questions', 50),
  ('lite', 'max_decks', 10),
  ('lite', 'max_question_banks', 5),
  ('lite', 'max_groups', 1),
  ('lite', 'max_students', 5),
  ('lite', 'max_quiz_attempts_per_day', 10),
  ('lite', 'max_ai_tokens_per_day', 0)
ON CONFLICT DO NOTHING;

-- Free tier — Launch (org)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('launch', 'max_flashcards', 100),
  ('launch', 'max_questions', 50),
  ('launch', 'max_decks', 10),
  ('launch', 'max_question_banks', 5),
  ('launch', 'max_groups', 3),
  ('launch', 'max_students', 5),
  ('launch', 'max_quiz_attempts_per_day', 10),
  ('launch', 'max_ai_tokens_per_day', 0)
ON CONFLICT DO NOTHING;

-- Basic tier — Spark (student)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('spark', 'max_flashcards', 500),
  ('spark', 'max_questions', 200),
  ('spark', 'max_decks', 50),
  ('spark', 'max_question_banks', 20),
  ('spark', 'max_quiz_attempts_per_day', 50),
  ('spark', 'max_ai_tokens_per_day', 0)
ON CONFLICT DO NOTHING;

-- Basic tier — Guide (educator)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('guide', 'max_flashcards', 500),
  ('guide', 'max_questions', 200),
  ('guide', 'max_decks', 50),
  ('guide', 'max_question_banks', 20),
  ('guide', 'max_groups', 5),
  ('guide', 'max_students', 5),
  ('guide', 'max_quiz_attempts_per_day', 50),
  ('guide', 'max_ai_tokens_per_day', 0)
ON CONFLICT DO NOTHING;

-- Basic tier — Team (org)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('team', 'max_flashcards', 500),
  ('team', 'max_questions', 200),
  ('team', 'max_decks', 50),
  ('team', 'max_question_banks', 20),
  ('team', 'max_groups', 5),
  ('team', 'max_students', 5),
  ('team', 'max_quiz_attempts_per_day', 50),
  ('team', 'max_ai_tokens_per_day', 0)
ON CONFLICT DO NOTHING;

-- Premium tier — Ace (student)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('ace', 'max_flashcards', 2000),
  ('ace', 'max_questions', 1000),
  ('ace', 'max_decks', 200),
  ('ace', 'max_question_banks', 100),
  ('ace', 'max_quiz_attempts_per_day', -1),
  ('ace', 'max_ai_tokens_per_day', 200000)
ON CONFLICT DO NOTHING;

-- Premium tier — Creator (educator)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('creator', 'max_flashcards', 2000),
  ('creator', 'max_questions', 1000),
  ('creator', 'max_decks', 200),
  ('creator', 'max_question_banks', 100),
  ('creator', 'max_groups', 20),
  ('creator', 'max_students', 50),
  ('creator', 'max_quiz_attempts_per_day', -1),
  ('creator', 'max_ai_tokens_per_day', 200000)
ON CONFLICT DO NOTHING;

-- Premium tier — Hub (org)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('hub', 'max_flashcards', 2000),
  ('hub', 'max_questions', 1000),
  ('hub', 'max_decks', 200),
  ('hub', 'max_question_banks', 100),
  ('hub', 'max_groups', 20),
  ('hub', 'max_students', 50),
  ('hub', 'max_quiz_attempts_per_day', -1),
  ('hub', 'max_ai_tokens_per_day', 200000)
ON CONFLICT DO NOTHING;

-- Advanced tier — Pro (student)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('pro', 'max_flashcards', -1),
  ('pro', 'max_questions', -1),
  ('pro', 'max_decks', -1),
  ('pro', 'max_question_banks', -1),
  ('pro', 'max_quiz_attempts_per_day', -1),
  ('pro', 'max_ai_tokens_per_day', -1)
ON CONFLICT DO NOTHING;

-- Advanced tier — Master (educator)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('master', 'max_flashcards', -1),
  ('master', 'max_questions', -1),
  ('master', 'max_decks', -1),
  ('master', 'max_question_banks', -1),
  ('master', 'max_groups', -1),
  ('master', 'max_students', -1),
  ('master', 'max_quiz_attempts_per_day', -1),
  ('master', 'max_ai_tokens_per_day', -1),
  ('master', 'max_storage_mb', -1)
ON CONFLICT DO NOTHING;

-- Advanced tier — Campus (org)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('campus', 'max_flashcards', -1),
  ('campus', 'max_questions', -1),
  ('campus', 'max_decks', -1),
  ('campus', 'max_question_banks', -1),
  ('campus', 'max_groups', -1),
  ('campus', 'max_students', -1),
  ('campus', 'max_quiz_attempts_per_day', -1),
  ('campus', 'max_ai_tokens_per_day', -1),
  ('campus', 'max_storage_mb', -1)
ON CONFLICT DO NOTHING;

-- Sysadmin (internal)
INSERT INTO public.plan_limits (plan_key, limit_key, limit_value) VALUES
  ('sysadmin', 'max_flashcards', -1),
  ('sysadmin', 'max_questions', -1),
  ('sysadmin', 'max_decks', -1),
  ('sysadmin', 'max_question_banks', -1),
  ('sysadmin', 'max_students', -1),
  ('sysadmin', 'max_groups', -1),
  ('sysadmin', 'max_quiz_attempts_per_day', -1),
  ('sysadmin', 'max_ai_tokens_per_day', -1),
  ('sysadmin', 'max_storage_mb', -1)
ON CONFLICT DO NOTHING;

-- ==========================================================
-- 8. Plan seat allocations (Phase 2 — seat-based licensing)
-- ==========================================================
DELETE FROM public.plan_seat_allocations;

INSERT INTO public.plan_seat_allocations (org_plan, seat_plan, default_qty) VALUES
  ('launch', 'launch', 1),
  ('team',   'team',   5),
  ('hub',    'hub',    20),
  ('campus', 'pro',    50),
  ('campus', 'master', 10),
  ('campus', 'campus', 5)
ON CONFLICT DO NOTHING;
