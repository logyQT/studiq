-- ==========================================================
-- Seed: 01 — Core dev data
-- Creates org, auth users + identities, profiles,
-- org memberships, and optional dev content.
-- Password for all accounts: pass
-- ==========================================================

-- ==========================================================
-- TIER 1: Organization & Users (no content)
-- ==========================================================

-- Org
INSERT INTO "public"."organizations" ("id", "name") VALUES
  ('00000000-0000-4000-8000-000000000001', 'WSB Merito')
ON CONFLICT DO NOTHING;

-- Seed default roles for the dev org
INSERT INTO "public"."org_roles" ("organization_id", "name", "description", "is_system") VALUES
  ('00000000-0000-4000-8000-000000000001', 'member', 'Base learner — read org content, create own', true),
  ('00000000-0000-4000-8000-000000000001', 'teacher', 'Educator — full CRUD over org content', true),
  ('00000000-0000-4000-8000-000000000001', 'admin', 'Org manager — settings, members, roles', true)
ON CONFLICT DO NOTHING;

-- Auth users
INSERT INTO "auth"."users" (
  "instance_id", "id", "aud", "role", "email", "encrypted_password",
  "email_confirmed_at", "invited_at", "confirmation_token", "confirmation_sent_at",
  "recovery_token", "recovery_sent_at", "email_change_token_new", "email_change",
  "email_change_sent_at", "last_sign_in_at", "raw_app_meta_data", "raw_user_meta_data",
  "is_super_admin", "created_at", "updated_at", "phone", "phone_confirmed_at",
  "phone_change", "phone_change_token", "phone_change_sent_at",
  "email_change_token_current", "email_change_confirm_status", "banned_until",
  "reauthentication_token", "reauthentication_sent_at", "is_sso_user", "deleted_at", "is_anonymous"
) VALUES
  -- sys_admin (platform-wide, no org)
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000001',
    'authenticated', 'authenticated', 'admin@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "manager", "provider": "email", "providers": ["email"]}',
    '{"name": "Sys Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- university_admin (Dev University)
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000002',
    'authenticated', 'authenticated', 'manager@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "manager", "provider": "email", "providers": ["email"]}',
    '{"name": "Manager", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- teacher (Dev University)
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000003',
    'authenticated', 'authenticated', 'teacher@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "educator", "provider": "email", "providers": ["email"]}',
    '{"name": "Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- student 1–5 (Dev University — classroom)
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000004',
    'authenticated', 'authenticated', 'student1@classroom.dev',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student 1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000005',
    'authenticated', 'authenticated', 'student2@classroom.dev',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student 2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000006',
    'authenticated', 'authenticated', 'student3@classroom.dev',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student 3", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000007',
    'authenticated', 'authenticated', 'student4@classroom.dev',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student 4", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000008',
    'authenticated', 'authenticated', 'student5@classroom.dev',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student 5", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false )
ON CONFLICT DO NOTHING;

-- Auth identities (required for signInWithPassword)
INSERT INTO "auth"."identities" (
  "provider_id", "user_id", "identity_data", "provider",
  "last_sign_in_at", "created_at", "updated_at", "id"
) VALUES
  ( '00000000-0000-4000-8001-000000000001',
    '00000000-0000-4000-8001-000000000001',
    '{"sub": "00000000-0000-4000-8001-000000000001", "email": "admin@dev.local",         "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000001' ),
  ( '00000000-0000-4000-8001-000000000002',
    '00000000-0000-4000-8001-000000000002',
    '{"sub": "00000000-0000-4000-8001-000000000002", "email": "manager@dev.local",        "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000002' ),
  ( '00000000-0000-4000-8001-000000000003',
    '00000000-0000-4000-8001-000000000003',
    '{"sub": "00000000-0000-4000-8001-000000000003", "email": "teacher@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000003' ),
  ( '00000000-0000-4000-8001-000000000004',
    '00000000-0000-4000-8001-000000000004',
    '{"sub": "00000000-0000-4000-8001-000000000004", "email": "student1@classroom.dev",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000004' ),
  ( '00000000-0000-4000-8001-000000000005',
    '00000000-0000-4000-8001-000000000005',
    '{"sub": "00000000-0000-4000-8001-000000000005", "email": "student2@classroom.dev",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000005' ),
  ( '00000000-0000-4000-8001-000000000006',
    '00000000-0000-4000-8001-000000000006',
    '{"sub": "00000000-0000-4000-8001-000000000006", "email": "student3@classroom.dev",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000006' ),
  ( '00000000-0000-4000-8001-000000000007',
    '00000000-0000-4000-8001-000000000007',
    '{"sub": "00000000-0000-4000-8001-000000000007", "email": "student4@classroom.dev",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000007' ),
  ( '00000000-0000-4000-8001-000000000008',
    '00000000-0000-4000-8001-000000000008',
    '{"sub": "00000000-0000-4000-8001-000000000008", "email": "student5@classroom.dev",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000008' )
ON CONFLICT DO NOTHING;

-- Profiles (auto-created by trigger, but seed explicitly)
INSERT INTO "public"."profiles" ("id", "email", "full_name") VALUES
  ('00000000-0000-4000-8001-000000000001', 'admin@dev.local',        'Sys Admin'),
  ('00000000-0000-4000-8001-000000000002', 'manager@dev.local',      'Manager'),
  ('00000000-0000-4000-8001-000000000003', 'teacher@dev.local',      'Teacher'),
  ('00000000-0000-4000-8001-000000000004', 'student1@classroom.dev', 'Student 1'),
  ('00000000-0000-4000-8001-000000000005', 'student2@classroom.dev', 'Student 2'),
  ('00000000-0000-4000-8001-000000000006', 'student3@classroom.dev', 'Student 3'),
  ('00000000-0000-4000-8001-000000000007', 'student4@classroom.dev', 'Student 4'),
  ('00000000-0000-4000-8001-000000000008', 'student5@classroom.dev', 'Student 5')
ON CONFLICT DO NOTHING;

-- Org memberships (admin/manager intentionally excluded — has no org membership)
INSERT INTO "public"."org_members" ("organization_id", "user_id", "org_role_id") VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000002', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'admin')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'teacher')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'member')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000005', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'member')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000006', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'member')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000007', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'member')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000008', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'member'))
ON CONFLICT DO NOTHING;

-- Default group for Dev University
INSERT INTO "public"."groups" ("id", "organization_id", "name", "description", "is_default") VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Członkowie', NULL, true)
ON CONFLICT DO NOTHING;

-- Group memberships (teacher + all students)
INSERT INTO "public"."group_members" ("group_id", "user_id", "role") VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000003', 'teacher'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000004', 'member'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000005', 'member'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000006', 'member'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000007', 'member'),
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'member')
ON CONFLICT DO NOTHING;

-- ==========================================================
-- TIER 2: Dev Content
-- ==========================================================

-- Topics created by teacher (shared via visibility = 'group')
INSERT INTO "public"."topics" ("id", "organization_id", "created_by", "name", "visibility") VALUES
  ('00000000-0000-4000-8010-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'JavaScript',   'group'),
  ('00000000-0000-4000-8010-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'React',        'group'),
  ('00000000-0000-4000-8010-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'Database Design', 'group')
ON CONFLICT DO NOTHING;

-- Topics created by student (personal)
INSERT INTO "public"."topics" ("id", "organization_id", "created_by", "name", "visibility") VALUES
  ('00000000-0000-4000-8010-000000000004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'My Notes',    'personal'),
  ('00000000-0000-4000-8010-000000000005', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'Study Tips',  'personal')
ON CONFLICT DO NOTHING;

-- Decks created by teacher
INSERT INTO "public"."flashcard_decks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8006-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'JS Basics',          'Core JavaScript fundamentals',   'group'),
  ('00000000-0000-4000-8006-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'React Fundamentals', 'React component basics',         'group')
ON CONFLICT DO NOTHING;

-- Deck created by student
INSERT INTO "public"."flashcard_decks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8006-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'Personal Notes', 'My personal study notes', 'personal')
ON CONFLICT DO NOTHING;

-- Flashcards created by teacher (visibility inherited from deck)
INSERT INTO "public"."flashcards" ("id", "organization_id", "created_by", "front", "back", "visibility") VALUES
  ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'What is a closure in JavaScript?', 'A function that retains access to its outer scope even after the outer function has returned.', 'group'),
  ('00000000-0000-4000-8005-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'What is the difference between let and var?', 'let is block-scoped, var is function-scoped.', 'group'),
  ('00000000-0000-4000-8005-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'What is a Promise?', 'An object representing the eventual completion or failure of an asynchronous operation.', 'group'),
  ('00000000-0000-4000-8005-000000000004', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'What is JSX?', 'A syntax extension for JavaScript that looks like HTML and is used with React.', 'group'),
  ('00000000-0000-4000-8005-000000000005', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'What is a component in React?', 'A reusable piece of UI that can manage its own state and render output.', 'group')
ON CONFLICT DO NOTHING;

-- Flashcards created by student
INSERT INTO "public"."flashcards" ("id", "organization_id", "created_by", "front", "back", "visibility") VALUES
  ('00000000-0000-4000-8005-000000000006', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'What did I learn today?', 'Closures and Promises — need more practice on async error handling.', 'personal'),
  ('00000000-0000-4000-8005-000000000007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'Exam topic to review', 'Database normalization forms (1NF, 2NF, 3NF).', 'personal')
ON CONFLICT DO NOTHING;

-- Flashcard-deck assignments
INSERT INTO "public"."flashcard_deck_assignments" ("flashcard_id", "deck_id") VALUES
  ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8006-000000000001'),
  ('00000000-0000-4000-8005-000000000002', '00000000-0000-4000-8006-000000000001'),
  ('00000000-0000-4000-8005-000000000003', '00000000-0000-4000-8006-000000000001'),
  ('00000000-0000-4000-8005-000000000004', '00000000-0000-4000-8006-000000000002'),
  ('00000000-0000-4000-8005-000000000005', '00000000-0000-4000-8006-000000000002'),
  ('00000000-0000-4000-8005-000000000006', '00000000-0000-4000-8006-000000000003'),
  ('00000000-0000-4000-8005-000000000007', '00000000-0000-4000-8006-000000000003')
ON CONFLICT DO NOTHING;

-- Flashcard-topic assignments
INSERT INTO "public"."flashcard_topic_assignments" ("flashcard_id", "topic_id") VALUES
  ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8010-000000000001'),
  ('00000000-0000-4000-8005-000000000002', '00000000-0000-4000-8010-000000000001'),
  ('00000000-0000-4000-8005-000000000003', '00000000-0000-4000-8010-000000000001'),
  ('00000000-0000-4000-8005-000000000004', '00000000-0000-4000-8010-000000000002'),
  ('00000000-0000-4000-8005-000000000005', '00000000-0000-4000-8010-000000000002'),
  ('00000000-0000-4000-8005-000000000006', '00000000-0000-4000-8010-000000000004'),
  ('00000000-0000-4000-8005-000000000007', '00000000-0000-4000-8010-000000000005')
ON CONFLICT DO NOTHING;

-- Question banks created by teacher
INSERT INTO "public"."question_banks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8020-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'JS Quiz', 'JavaScript fundamentals quiz', 'group')
ON CONFLICT DO NOTHING;

-- Questions created by teacher
INSERT INTO "public"."questions" ("id", "organization_id", "created_by", "type", "content", "explanation", "visibility") VALUES
  ('00000000-0000-4000-8030-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'Which of the following is NOT a JavaScript data type?', '"Symbol" was added in ES6 and is a valid data type.', 'group'),
  ('00000000-0000-4000-8030-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'What does the === operator do?', 'It compares both value and type without type coercion.', 'group'),
  ('00000000-0000-4000-8030-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'true_false', 'In JavaScript, null is an object.', 'This is a well-known quirk of JavaScript — typeof null returns "object".', 'group')
ON CONFLICT DO NOTHING;

-- Question-bank assignments
INSERT INTO "public"."question_bank_assignments" ("question_id", "bank_id") VALUES
  ('00000000-0000-4000-8030-000000000001', '00000000-0000-4000-8020-000000000001'),
  ('00000000-0000-4000-8030-000000000002', '00000000-0000-4000-8020-000000000001'),
  ('00000000-0000-4000-8030-000000000003', '00000000-0000-4000-8020-000000000001')
ON CONFLICT DO NOTHING;

-- Deck-group assignments
INSERT INTO "public"."deck_groups" ("deck_id", "group_id") VALUES
  ('00000000-0000-4000-8006-000000000001', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8006-000000000002', '00000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

-- Bank-group assignments
INSERT INTO "public"."bank_groups" ("bank_id", "group_id") VALUES
  ('00000000-0000-4000-8020-000000000001', '00000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;

-- Topic-group assignments
INSERT INTO "public"."topic_groups" ("topic_id", "group_id") VALUES
  ('00000000-0000-4000-8010-000000000001', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8010-000000000002', '00000000-0000-4000-8000-000000000002'),
  ('00000000-0000-4000-8010-000000000003', '00000000-0000-4000-8000-000000000002')
ON CONFLICT DO NOTHING;
