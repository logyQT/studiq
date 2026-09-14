-- ==========================================================
-- Seed: 01 — Core dev data
-- 3 orgs, 8 users, 4 groups
-- Labels only — no educational content, just identifiers
-- Password for all accounts: pass
-- ==========================================================

-- ==========================================================
-- TIER 1: Organizations & Users
-- ==========================================================

-- Org 1
INSERT INTO "public"."organizations" ("id", "name", "plan") VALUES
  ('00000000-0000-4000-8000-000000000001', 'WSB Merito', 'launch')
ON CONFLICT DO NOTHING;

-- Org 2
INSERT INTO "public"."organizations" ("id", "name", "plan") VALUES
  ('00000000-0000-4000-8000-00000000000A', 'UE Wroc\u0142aw', 'launch')
ON CONFLICT DO NOTHING;

-- Org 3
INSERT INTO "public"."organizations" ("id", "name", "plan") VALUES
  ('00000000-0000-4000-8000-00000000000E', 'Akademia G\u00f3rnicza', 'launch')
ON CONFLICT DO NOTHING;

-- Org roles for Org 1
INSERT INTO "public"."org_roles" ("organization_id", "name", "description", "display_name", "is_system") VALUES
  ('00000000-0000-4000-8000-000000000001', 'member', 'Base learner', 'Student', true),
  ('00000000-0000-4000-8000-000000000001', 'teacher', 'Educator', 'Teacher', true),
  ('00000000-0000-4000-8000-000000000001', 'admin', 'Org manager', 'Admin', true)
ON CONFLICT DO NOTHING;

-- Org roles for Org 2
INSERT INTO "public"."org_roles" ("organization_id", "name", "description", "display_name", "is_system") VALUES
  ('00000000-0000-4000-8000-00000000000A', 'member', 'Base learner', 'Student', true),
  ('00000000-0000-4000-8000-00000000000A', 'teacher', 'Educator', 'Teacher', true),
  ('00000000-0000-4000-8000-00000000000A', 'admin', 'Org manager', 'Admin', true)
ON CONFLICT DO NOTHING;

-- Org roles for Org 3
INSERT INTO "public"."org_roles" ("organization_id", "name", "description", "display_name", "is_system") VALUES
  ('00000000-0000-4000-8000-00000000000E', 'member', 'Base learner', 'Student', true),
  ('00000000-0000-4000-8000-00000000000E', 'teacher', 'Educator', 'Teacher', true),
  ('00000000-0000-4000-8000-00000000000E', 'admin', 'Org manager', 'Admin', true)
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
    '{"account_type": "sys_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "Sys Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- M1 — manager of O1, O2
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000002',
    'authenticated', 'authenticated', 'manager@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "manager", "provider": "email", "providers": ["email"]}',
    '{"name": "M1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- M2 — manager of O3 only
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000008',
    'authenticated', 'authenticated', 'manager2@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "manager", "provider": "email", "providers": ["email"]}',
    '{"name": "M2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- T1 — teacher of O1, O2
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000003',
    'authenticated', 'authenticated', 'teacher1@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "educator", "provider": "email", "providers": ["email"]}',
    '{"name": "T1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- T2 — teacher of O1, O2
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000004',
    'authenticated', 'authenticated', 'teacher2@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "educator", "provider": "email", "providers": ["email"]}',
    '{"name": "T2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- S1 — member of O1 only
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000005',
    'authenticated', 'authenticated', 'student1@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "S1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- S2 — member of O2 only
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000006',
    'authenticated', 'authenticated', 'student2@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "S2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- S3 — org-less student
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000007',
    'authenticated', 'authenticated', 'student3@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "S3", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  -- TS -- test student (no pre-existing content)
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000009',
    'authenticated', 'authenticated', 'test-student@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "TestStudent", "account_type": "student", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false )
ON CONFLICT DO NOTHING;

-- Auth identities
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
  ( '00000000-0000-4000-8001-000000000008',
    '00000000-0000-4000-8001-000000000008',
    '{"sub": "00000000-0000-4000-8001-000000000008", "email": "manager2@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000008' ),
  ( '00000000-0000-4000-8001-000000000003',
    '00000000-0000-4000-8001-000000000003',
    '{"sub": "00000000-0000-4000-8001-000000000003", "email": "teacher1@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000003' ),
  ( '00000000-0000-4000-8001-000000000004',
    '00000000-0000-4000-8001-000000000004',
    '{"sub": "00000000-0000-4000-8001-000000000004", "email": "teacher2@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000004' ),
  ( '00000000-0000-4000-8001-000000000005',
    '00000000-0000-4000-8001-000000000005',
    '{"sub": "00000000-0000-4000-8001-000000000005", "email": "student1@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000005' ),
  ( '00000000-0000-4000-8001-000000000006',
    '00000000-0000-4000-8001-000000000006',
    '{"sub": "00000000-0000-4000-8001-000000000006", "email": "student2@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000006' ),
  ( '00000000-0000-4000-8001-000000000007',
    '00000000-0000-4000-8001-000000000007',
    '{"sub": "00000000-0000-4000-8001-000000000007", "email": "student3@dev.local",       "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000007' ),
  ( '00000000-0000-4000-8001-000000000009',
    '00000000-0000-4000-8001-000000000009',
    '{"sub": "00000000-0000-4000-8001-000000000009", "email": "test-student@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000009' )
ON CONFLICT DO NOTHING;

-- Profiles
INSERT INTO "public"."profiles" ("id", "email", "full_name", "personal_plan_key") VALUES
  ('00000000-0000-4000-8001-000000000001', 'admin@dev.local',    'Sys Admin', 'sysadmin'),
  ('00000000-0000-4000-8001-000000000002', 'manager@dev.local',  'M1',        'launch'),
  ('00000000-0000-4000-8001-000000000008', 'manager2@dev.local', 'M2',        'launch'),
  ('00000000-0000-4000-8001-000000000003', 'teacher1@dev.local', 'T1',        'lite'),
  ('00000000-0000-4000-8001-000000000004', 'teacher2@dev.local', 'T2',        'lite'),
  ('00000000-0000-4000-8001-000000000005', 'student1@dev.local', 'S1',        'base'),
  ('00000000-0000-4000-8001-000000000006', 'student2@dev.local', 'S2',        'base'),
  ('00000000-0000-4000-8001-000000000007', 'student3@dev.local', 'S3',        'base'),
  ('00000000-0000-4000-8001-000000000009', 'test-student@dev.local', 'TestStudent', 'base')
ON CONFLICT DO NOTHING;

-- Org memberships (sys_admin excluded)
-- Org 1
INSERT INTO "public"."org_members" ("organization_id", "user_id", "org_role_id") VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000002', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'admin')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'teacher')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'teacher')),
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000005', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-000000000001' AND name = 'member'))
ON CONFLICT DO NOTHING;
-- Org 2
INSERT INTO "public"."org_members" ("organization_id", "user_id", "org_role_id") VALUES
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000002', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000A' AND name = 'admin')),
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000A' AND name = 'teacher')),
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000004', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000A' AND name = 'teacher')),
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000006', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000A' AND name = 'member'))
ON CONFLICT DO NOTHING;
-- Org 3 (M2 only)
INSERT INTO "public"."org_members" ("organization_id", "user_id", "org_role_id") VALUES
  ('00000000-0000-4000-8000-00000000000E', '00000000-0000-4000-8001-000000000008', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000E' AND name = 'admin'))
ON CONFLICT DO NOTHING;

-- Groups
INSERT INTO "public"."groups" ("id", "organization_id", "name", "description") VALUES
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8000-000000000001', 'O1G1', 'O1 Group 1 — T1, S1'),
  ('00000000-0000-4000-8000-00000000000B', '00000000-0000-4000-8000-000000000001', 'O1G2', 'O1 Group 2 — T2'),
  ('00000000-0000-4000-8000-00000000000C', '00000000-0000-4000-8000-00000000000A', 'O2G1', 'O2 Group 1 — T1, S2'),
  ('00000000-0000-4000-8000-00000000000D', '00000000-0000-4000-8000-00000000000A', 'O2G2', 'O2 Group 2 — T2')
ON CONFLICT DO NOTHING;

-- Group memberships
INSERT INTO "public"."group_members" ("group_id", "user_id", "role") VALUES
  -- O1G1
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', 'teacher'),
  ('00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000005', 'member'),
  -- O1G2
  ('00000000-0000-4000-8000-00000000000B', '00000000-0000-4000-8001-000000000004', 'teacher'),
  -- O2G1
  ('00000000-0000-4000-8000-00000000000C', '00000000-0000-4000-8001-000000000003', 'teacher'),
  ('00000000-0000-4000-8000-00000000000C', '00000000-0000-4000-8001-000000000006', 'member'),
  -- O2G2
  ('00000000-0000-4000-8000-00000000000D', '00000000-0000-4000-8001-000000000004', 'teacher')
ON CONFLICT DO NOTHING;


-- ==========================================================
-- TIER 2: Content — Labels Only
-- ==========================================================

-- Topics
INSERT INTO "public"."topics" ("id", "organization_id", "created_by", "name", "visibility") VALUES
  ('00000000-0000-4000-8010-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'O1G1T1', 'group'),
  ('00000000-0000-4000-8010-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'O1G2T2', 'group'),
  ('00000000-0000-4000-8010-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000005', 'O1S1',   'personal'),
  ('00000000-0000-4000-8010-000000000004', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', 'O2G1T1', 'group'),
  ('00000000-0000-4000-8010-000000000005', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000004', 'O2G2T2', 'group'),
  ('00000000-0000-4000-8010-000000000006', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000006', 'O2S2',   'personal'),
  ('00000000-0000-4000-8010-000000000007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000007', 'S3',     'personal')
ON CONFLICT DO NOTHING;

-- Topic-group assignments (group-visibility topics only)
INSERT INTO "public"."topic_groups" ("topic_id", "group_id") VALUES
  ('00000000-0000-4000-8010-000000000001', '00000000-0000-4000-8000-00000000000A'),
  ('00000000-0000-4000-8010-000000000002', '00000000-0000-4000-8000-00000000000B'),
  ('00000000-0000-4000-8010-000000000004', '00000000-0000-4000-8000-00000000000C'),
  ('00000000-0000-4000-8010-000000000005', '00000000-0000-4000-8000-00000000000D')
ON CONFLICT DO NOTHING;

-- Decks
INSERT INTO "public"."flashcard_decks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8006-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'O1G1T1', 'O1G1T1', 'group'),
  ('00000000-0000-4000-8006-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'O1G2T2', 'O1G2T2', 'group'),
  ('00000000-0000-4000-8006-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000005', 'O1S1',   'O1S1',   'personal'),
  ('00000000-0000-4000-8006-000000000004', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', 'O2G1T1', 'O2G1T1', 'group'),
  ('00000000-0000-4000-8006-000000000005', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000004', 'O2G2T2', 'O2G2T2', 'group'),
  ('00000000-0000-4000-8006-000000000006', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000006', 'O2S2',   'O2S2',   'personal'),
  ('00000000-0000-4000-8006-000000000007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000007', 'S3',     'S3',     'personal')
ON CONFLICT DO NOTHING;

-- Deck-group assignments (group-visibility decks only)
INSERT INTO "public"."deck_groups" ("deck_id", "group_id") VALUES
  ('00000000-0000-4000-8006-000000000001', '00000000-0000-4000-8000-00000000000A'),
  ('00000000-0000-4000-8006-000000000002', '00000000-0000-4000-8000-00000000000B'),
  ('00000000-0000-4000-8006-000000000004', '00000000-0000-4000-8000-00000000000C'),
  ('00000000-0000-4000-8006-000000000005', '00000000-0000-4000-8000-00000000000D')
ON CONFLICT DO NOTHING;

-- Banks
INSERT INTO "public"."question_banks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8020-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'O1G1T1', 'O1G1T1', 'group'),
  ('00000000-0000-4000-8020-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'O1G2T2', 'O1G2T2', 'group'),
  ('00000000-0000-4000-8020-000000000003', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', 'O2G1T1', 'O2G1T1', 'group'),
  ('00000000-0000-4000-8020-000000000004', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000004', 'O2G2T2', 'O2G2T2', 'group')
ON CONFLICT DO NOTHING;

-- Bank-group assignments
INSERT INTO "public"."bank_groups" ("bank_id", "group_id") VALUES
  ('00000000-0000-4000-8020-000000000001', '00000000-0000-4000-8000-00000000000A'),
  ('00000000-0000-4000-8020-000000000002', '00000000-0000-4000-8000-00000000000B'),
  ('00000000-0000-4000-8020-000000000003', '00000000-0000-4000-8000-00000000000C'),
  ('00000000-0000-4000-8020-000000000004', '00000000-0000-4000-8000-00000000000D')
ON CONFLICT DO NOTHING;

-- Flashcards
INSERT INTO "public"."flashcards" ("id", "organization_id", "created_by", "front", "back", "visibility", "deck_id") VALUES
  ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'O1G1T1', 'O1G1T1', 'group', '00000000-0000-4000-8006-000000000001'),
  ('00000000-0000-4000-8005-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'O1G2T2', 'O1G2T2', 'group', '00000000-0000-4000-8006-000000000002'),
  ('00000000-0000-4000-8005-000000000003', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000005', 'O1S1',   'O1S1',   'personal', '00000000-0000-4000-8006-000000000003'),
  ('00000000-0000-4000-8005-000000000004', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', 'O2G1T1', 'O2G1T1', 'group', '00000000-0000-4000-8006-000000000004'),
  ('00000000-0000-4000-8005-000000000005', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000004', 'O2G2T2', 'O2G2T2', 'group', '00000000-0000-4000-8006-000000000005'),
  ('00000000-0000-4000-8005-000000000006', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000006', 'O2S2',   'O2S2',   'personal', '00000000-0000-4000-8006-000000000006'),
  ('00000000-0000-4000-8005-000000000007', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000007', 'S3',     'S3',     'personal', '00000000-0000-4000-8006-000000000007')
ON CONFLICT DO NOTHING;

-- Flashcard-topic assignments
INSERT INTO "public"."flashcard_topic_assignments" ("flashcard_id", "topic_id") VALUES
  ('00000000-0000-4000-8005-000000000001', '00000000-0000-4000-8010-000000000001'),
  ('00000000-0000-4000-8005-000000000002', '00000000-0000-4000-8010-000000000002'),
  ('00000000-0000-4000-8005-000000000003', '00000000-0000-4000-8010-000000000003'),
  ('00000000-0000-4000-8005-000000000004', '00000000-0000-4000-8010-000000000004'),
  ('00000000-0000-4000-8005-000000000005', '00000000-0000-4000-8010-000000000005'),
  ('00000000-0000-4000-8005-000000000006', '00000000-0000-4000-8010-000000000006'),
  ('00000000-0000-4000-8005-000000000007', '00000000-0000-4000-8010-000000000007')
ON CONFLICT DO NOTHING;

-- Questions (teachers only)
INSERT INTO "public"."questions" ("id", "organization_id", "created_by", "type", "content", "explanation", "visibility", "bank_id") VALUES
  ('00000000-0000-4000-8030-000000000001', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'mcq', 'O1G1T1', 'O1G1T1', 'group', '00000000-0000-4000-8020-000000000001'),
  ('00000000-0000-4000-8030-000000000002', '00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'mcq', 'O1G2T2', 'O1G2T2', 'group', '00000000-0000-4000-8020-000000000002'),
  ('00000000-0000-4000-8030-000000000003', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000003', 'mcq', 'O2G1T1', 'O2G1T1', 'group', '00000000-0000-4000-8020-000000000003'),
  ('00000000-0000-4000-8030-000000000004', '00000000-0000-4000-8000-00000000000A', '00000000-0000-4000-8001-000000000004', 'mcq', 'O2G2T2', 'O2G2T2', 'group', '00000000-0000-4000-8020-000000000004')
ON CONFLICT DO NOTHING;

-- Question-topic assignments
INSERT INTO "public"."question_topic_assignments" ("question_id", "topic_id") VALUES
  ('00000000-0000-4000-8030-000000000001', '00000000-0000-4000-8010-000000000001'),
  ('00000000-0000-4000-8030-000000000002', '00000000-0000-4000-8010-000000000002'),
  ('00000000-0000-4000-8030-000000000003', '00000000-0000-4000-8010-000000000004'),
  ('00000000-0000-4000-8030-000000000004', '00000000-0000-4000-8010-000000000005')
ON CONFLICT DO NOTHING;

-- Question answers (4 per question, B is correct)
INSERT INTO "public"."question_options" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  ('00000000-0000-4000-8040-000000000001', '00000000-0000-4000-8030-000000000001', 'O1G1T1 A', false, 0),
  ('00000000-0000-4000-8040-000000000002', '00000000-0000-4000-8030-000000000001', 'O1G1T1 B', true,  1),
  ('00000000-0000-4000-8040-000000000003', '00000000-0000-4000-8030-000000000001', 'O1G1T1 C', false, 2),
  ('00000000-0000-4000-8040-000000000004', '00000000-0000-4000-8030-000000000001', 'O1G1T1 D', false, 3),
  ('00000000-0000-4000-8040-000000000005', '00000000-0000-4000-8030-000000000002', 'O1G2T2 A', false, 0),
  ('00000000-0000-4000-8040-000000000006', '00000000-0000-4000-8030-000000000002', 'O1G2T2 B', true,  1),
  ('00000000-0000-4000-8040-000000000007', '00000000-0000-4000-8030-000000000002', 'O1G2T2 C', false, 2),
  ('00000000-0000-4000-8040-000000000008', '00000000-0000-4000-8030-000000000002', 'O1G2T2 D', false, 3),
  ('00000000-0000-4000-8040-000000000009', '00000000-0000-4000-8030-000000000003', 'O2G1T1 A', false, 0),
  ('00000000-0000-4000-8040-00000000000A', '00000000-0000-4000-8030-000000000003', 'O2G1T1 B', true,  1),
  ('00000000-0000-4000-8040-00000000000B', '00000000-0000-4000-8030-000000000003', 'O2G1T1 C', false, 2),
  ('00000000-0000-4000-8040-00000000000C', '00000000-0000-4000-8030-000000000003', 'O2G1T1 D', false, 3),
  ('00000000-0000-4000-8040-00000000000D', '00000000-0000-4000-8030-000000000004', 'O2G2T2 A', false, 0),
  ('00000000-0000-4000-8040-00000000000E', '00000000-0000-4000-8030-000000000004', 'O2G2T2 B', true,  1),
  ('00000000-0000-4000-8040-00000000000F', '00000000-0000-4000-8030-000000000004', 'O2G2T2 C', false, 2),
   ('00000000-0000-4000-8040-000000000010', '00000000-0000-4000-8030-000000000004', 'O2G2T2 D', false, 3)
ON CONFLICT DO NOTHING;

-- ==========================================================
-- TIER 3: Classroom — standalone test org
-- Teacher with 1 student, 2 banks, 2 topics, 10 questions
-- ==========================================================

-- Org 4 — teacher-owned classroom
INSERT INTO "public"."organizations" ("id", "name", "plan") VALUES
  ('00000000-0000-4000-8000-00000000000F', 'Classroom', 'launch')
ON CONFLICT DO NOTHING;

-- Org roles for Org 4
INSERT INTO "public"."org_roles" ("organization_id", "name", "description", "display_name", "is_system") VALUES
  ('00000000-0000-4000-8000-00000000000F', 'member', 'Base learner', 'Student', true),
  ('00000000-0000-4000-8000-00000000000F', 'teacher', 'Educator', 'Teacher', true),
  ('00000000-0000-4000-8000-00000000000F', 'admin', 'Org manager', 'Admin', true)
ON CONFLICT DO NOTHING;

-- Classroom teacher
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
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-00000000000A',
    'authenticated', 'authenticated', 'teacher-classroom@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "educator", "provider": "email", "providers": ["email"]}',
    '{"name": "Classroom Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-00000000000B',
    'authenticated', 'authenticated', 'student-classroom@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"account_type": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Classroom Student", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false )
ON CONFLICT DO NOTHING;

-- Auth identities
INSERT INTO "auth"."identities" (
  "provider_id", "user_id", "identity_data", "provider",
  "last_sign_in_at", "created_at", "updated_at", "id"
) VALUES
  ( '00000000-0000-4000-8001-00000000000A',
    '00000000-0000-4000-8001-00000000000A',
    '{"sub": "00000000-0000-4000-8001-00000000000A", "email": "teacher-classroom@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-00000000000A' ),
  ( '00000000-0000-4000-8001-00000000000B',
    '00000000-0000-4000-8001-00000000000B',
    '{"sub": "00000000-0000-4000-8001-00000000000B", "email": "student-classroom@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-00000000000B' )
ON CONFLICT DO NOTHING;

-- Profiles
INSERT INTO "public"."profiles" ("id", "email", "full_name", "personal_plan_key") VALUES
  ('00000000-0000-4000-8001-00000000000A', 'teacher-classroom@dev.local', 'Classroom Teacher', 'launch'),
  ('00000000-0000-4000-8001-00000000000B', 'student-classroom@dev.local', 'Classroom Student', 'base')
ON CONFLICT DO NOTHING;

-- Org memberships
INSERT INTO "public"."org_members" ("organization_id", "user_id", "org_role_id") VALUES
  ('00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000F' AND name = 'admin')),
  ('00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000B', (SELECT id FROM public.org_roles WHERE organization_id = '00000000-0000-4000-8000-00000000000F' AND name = 'member'))
ON CONFLICT DO NOTHING;

-- Classroom group
INSERT INTO "public"."groups" ("id", "organization_id", "name", "description") VALUES
  ('00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8000-00000000000F', 'Classroom Group', 'Default group for Classroom')
ON CONFLICT DO NOTHING;

-- Group memberships
INSERT INTO "public"."group_members" ("group_id", "user_id", "role") VALUES
  ('00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'teacher'),
  ('00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000B', 'member')
ON CONFLICT DO NOTHING;

-- Banks
INSERT INTO "public"."question_banks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8020-000000000005', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Historia', 'Pytania z historii', 'group'),
  ('00000000-0000-4000-8020-000000000006', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Geografia i Nauka', 'Pytania z geografii i nauk przyrodniczych', 'group')
ON CONFLICT DO NOTHING;

-- Bank-group assignments
INSERT INTO "public"."bank_groups" ("bank_id", "group_id") VALUES
  ('00000000-0000-4000-8020-000000000005', '00000000-0000-4000-8000-00000000000F'),
  ('00000000-0000-4000-8020-000000000006', '00000000-0000-4000-8000-00000000000F')
ON CONFLICT DO NOTHING;

-- Topics
INSERT INTO "public"."topics" ("id", "organization_id", "created_by", "name", "visibility") VALUES
  ('00000000-0000-4000-8010-000000000008', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Średniowiecze', 'group'),
  ('00000000-0000-4000-8010-000000000009', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Odkrycia geograficzne', 'group')
ON CONFLICT DO NOTHING;

-- Topic-group assignments
INSERT INTO "public"."topic_groups" ("topic_id", "group_id") VALUES
  ('00000000-0000-4000-8010-000000000008', '00000000-0000-4000-8000-00000000000F'),
  ('00000000-0000-4000-8010-000000000009', '00000000-0000-4000-8000-00000000000F')
ON CONFLICT DO NOTHING;

-- Questions (10 total: 4 MCQ, 3 True/False, 3 Open)
INSERT INTO "public"."questions" ("id", "organization_id", "created_by", "type", "content", "explanation", "visibility", "bank_id") VALUES
  -- Bank 1: Historia — 2 MCQ, 1 TF, 1 Open
  ('00000000-0000-4000-8030-000000000005', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'mcq',        'Który rok uważa się za datę chrztu Polski?', 'Chrzest Polski przyjmuje się na rok 966.', 'group', '00000000-0000-4000-8020-000000000005'),
  ('00000000-0000-4000-8030-000000000006', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'mcq',        'Kto był pierwszym królem Polski?', 'Bolesław Chrobry został koronowany w 1025 roku.', 'group', '00000000-0000-4000-8020-000000000005'),
  ('00000000-0000-4000-8030-000000000007', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'true_false', 'Bitwa pod Grunwaldem miała miejsce w 1410 roku.', 'Tak, bitwa pod Grunwaldem odbyła się 15 lipca 1410.', 'group', '00000000-0000-4000-8020-000000000005'),
  ('00000000-0000-4000-8030-000000000008', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'open',       'Wymień trzy przyczyny upadku Rzeczypospolitej Obojga Narodów.', 'Liberum veto, słaba władza królewska, ingerencja mocarstw ościennych.', 'group', '00000000-0000-4000-8020-000000000005'),
  -- Bank 2: Geografia i Nauka — 2 MCQ, 2 TF, 2 Open
  ('00000000-0000-4000-8030-000000000009', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'mcq',        'Jaka jest najdłuższa rzeka w Polsce?', 'Wisła ma długość około 1047 km.', 'group', '00000000-0000-4000-8020-000000000006'),
  ('00000000-0000-4000-8030-00000000000A', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'mcq',        'Który pierwiastek chemiczny ma symbol Fe?', 'Fe to symbol żelaza (ferrum).', 'group', '00000000-0000-4000-8020-000000000006'),
  ('00000000-0000-4000-8030-00000000000B', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'true_false', 'Woda zamarza w temperaturze 0 stopni Celsjusza.', 'Tak, woda zamarza w 0°C pod ciśnieniem atmosferycznym.', 'group', '00000000-0000-4000-8020-000000000006'),
  ('00000000-0000-4000-8030-00000000000C', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'true_false', 'Australia jest największym kontynentem na Ziemi.', 'Australia jest najmniejszym kontynentem. Azja jest największa.', 'group', '00000000-0000-4000-8020-000000000006'),
  ('00000000-0000-4000-8030-00000000000D', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'open',       'Opisz krótko obieg wody w przyrodzie.', 'Parowanie → kondensacja → opady → spływ powierzchniowy → parowanie.', 'group', '00000000-0000-4000-8020-000000000006'),
  ('00000000-0000-4000-8030-00000000000E', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'open',       'Wymień trzy źródła energii odnawialnej.', 'Energia słoneczna, wiatrowa i wodna.', 'group', '00000000-0000-4000-8020-000000000006')
ON CONFLICT DO NOTHING;

-- Question-topic assignments
INSERT INTO "public"."question_topic_assignments" ("question_id", "topic_id") VALUES
  ('00000000-0000-4000-8030-000000000005', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8030-000000000006', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8030-000000000007', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8030-000000000008', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8030-000000000009', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8030-00000000000A', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8030-00000000000B', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8030-00000000000C', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8030-00000000000D', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8030-00000000000E', '00000000-0000-4000-8010-000000000009')
ON CONFLICT DO NOTHING;

-- Question answers (4 per question, 2nd option is correct for MCQ/TF)
INSERT INTO "public"."question_options" ("id", "question_id", "content", "is_correct", "order_index") VALUES
  -- Q1 (MCQ): Chrzest Polski
  ('00000000-0000-4000-8040-000000000011', '00000000-0000-4000-8030-000000000005', '866',  false, 0),
  ('00000000-0000-4000-8040-000000000012', '00000000-0000-4000-8030-000000000005', '966',  true,  1),
  ('00000000-0000-4000-8040-000000000013', '00000000-0000-4000-8030-000000000005', '1000', false, 2),
  ('00000000-0000-4000-8040-000000000014', '00000000-0000-4000-8030-000000000005', '1025', false, 3),
  -- Q2 (MCQ): Pierwszy król Polski
  ('00000000-0000-4000-8040-000000000015', '00000000-0000-4000-8030-000000000006', 'Mieszko I',             false, 0),
  ('00000000-0000-4000-8040-000000000016', '00000000-0000-4000-8030-000000000006', 'Bolesław Chrobry',      true,  1),
  ('00000000-0000-4000-8040-000000000017', '00000000-0000-4000-8030-000000000006', 'Kazimierz Wielki',      false, 2),
  ('00000000-0000-4000-8040-000000000018', '00000000-0000-4000-8030-000000000006', 'Władysław Łokietek',    false, 3),
  -- Q3 (TF): Grunwald 1410
  ('00000000-0000-4000-8040-000000000019', '00000000-0000-4000-8030-000000000007', 'Prawda',  true,  0),
  ('00000000-0000-4000-8040-00000000001A', '00000000-0000-4000-8030-000000000007', 'Fałsz',   false, 1),
  -- Q4 (OPEN): Przyczyny upadku Rzeczypospolitej — no answers needed
  -- Q5 (MCQ): Najdłuższa rzeka w Polsce
  ('00000000-0000-4000-8040-00000000001B', '00000000-0000-4000-8030-000000000009', 'Odra',   false, 0),
  ('00000000-0000-4000-8040-00000000001C', '00000000-0000-4000-8030-000000000009', 'Wisła',  true,  1),
  ('00000000-0000-4000-8040-00000000001D', '00000000-0000-4000-8030-000000000009', 'Warta',  false, 2),
  ('00000000-0000-4000-8040-00000000001E', '00000000-0000-4000-8030-000000000009', 'Bug',    false, 3),
  -- Q6 (MCQ): Symbol Fe
  ('00000000-0000-4000-8040-00000000001F', '00000000-0000-4000-8030-00000000000A', 'Fluor',  false, 0),
  ('00000000-0000-4000-8040-000000000020', '00000000-0000-4000-8030-00000000000A', 'Żelazo', true,  1),
  ('00000000-0000-4000-8040-000000000021', '00000000-0000-4000-8030-00000000000A', 'Fosfor', false, 2),
  ('00000000-0000-4000-8040-000000000022', '00000000-0000-4000-8030-00000000000A', 'Fran',   false, 3),
  -- Q7 (TF): Woda zamarza w 0°C
  ('00000000-0000-4000-8040-000000000023', '00000000-0000-4000-8030-00000000000B', 'Prawda', true,  0),
  ('00000000-0000-4000-8040-000000000024', '00000000-0000-4000-8030-00000000000B', 'Fałsz',  false, 1),
  -- Q8 (TF): Australia największym kontynentem
  ('00000000-0000-4000-8040-000000000025', '00000000-0000-4000-8030-00000000000C', 'Prawda', false, 0),
  ('00000000-0000-4000-8040-000000000026', '00000000-0000-4000-8030-00000000000C', 'Fałsz',  true,  1)
  -- Q9 (OPEN): Obieg wody — no answers needed
  -- Q10 (OPEN): Źródła energii odnawialnej — no answers needed
ON CONFLICT DO NOTHING;

-- Flashcard decks
INSERT INTO "public"."flashcard_decks" ("id", "organization_id", "created_by", "name", "description", "visibility") VALUES
  ('00000000-0000-4000-8006-000000000008', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Historia - fiszki', 'Fiszki z historii', 'group'),
  ('00000000-0000-4000-8006-000000000009', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Geografia - fiszki', 'Fiszki z geografii', 'group')
ON CONFLICT DO NOTHING;

-- Deck-group assignments
INSERT INTO "public"."deck_groups" ("deck_id", "group_id") VALUES
  ('00000000-0000-4000-8006-000000000008', '00000000-0000-4000-8000-00000000000F'),
  ('00000000-0000-4000-8006-000000000009', '00000000-0000-4000-8000-00000000000F')
ON CONFLICT DO NOTHING;

-- Flashcards (4 per deck)
INSERT INTO "public"."flashcards" ("id", "organization_id", "created_by", "front", "back", "visibility", "deck_id") VALUES
  ('00000000-0000-4000-8005-000000000008', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Kiedy miała miejsce bitwa pod Grunwaldem?', '1410 rok', 'group', '00000000-0000-4000-8006-000000000008'),
  ('00000000-0000-4000-8005-000000000009', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Kim był Mieszko I?', 'Pierwszym historycznym władcą Polski', 'group', '00000000-0000-4000-8006-000000000008'),
  ('00000000-0000-4000-8005-00000000000A', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Co to było liberum veto?', 'Prawo każdego posła do zablokowania uchwały sejmu', 'group', '00000000-0000-4000-8006-000000000008'),
  ('00000000-0000-4000-8005-00000000000B', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Kto był ostatnim królem Polski?', 'Stanisław August Poniatowski', 'group', '00000000-0000-4000-8006-000000000008'),
  ('00000000-0000-4000-8005-00000000000C', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Jaka jest stolica Francji?', 'Paryż', 'group', '00000000-0000-4000-8006-000000000009'),
  ('00000000-0000-4000-8005-00000000000D', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Jaki jest największy ocean na Ziemi?', 'Spokojny (Pacyfik)', 'group', '00000000-0000-4000-8006-000000000009'),
  ('00000000-0000-4000-8005-00000000000E', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Ile planet liczy Układ Słoneczny?', '8', 'group', '00000000-0000-4000-8006-000000000009'),
  ('00000000-0000-4000-8005-00000000000F', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Czym jest atmosfera?', 'Powłoką gazową otaczającą Ziemię', 'group', '00000000-0000-4000-8006-000000000009')
ON CONFLICT DO NOTHING;

-- Flashcard-topic assignments
INSERT INTO "public"."flashcard_topic_assignments" ("flashcard_id", "topic_id") VALUES
  ('00000000-0000-4000-8005-000000000008', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8005-000000000009', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8005-00000000000A', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8005-00000000000B', '00000000-0000-4000-8010-000000000008'),
  ('00000000-0000-4000-8005-00000000000C', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8005-00000000000D', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8005-00000000000E', '00000000-0000-4000-8010-000000000009'),
  ('00000000-0000-4000-8005-00000000000F', '00000000-0000-4000-8010-000000000009')
ON CONFLICT DO NOTHING;

-- ==========================================================
-- TIER 4: Quizzes (reusable question sets from classroom data)
-- ==========================================================

-- Quiz 1: Historia — Średniowiecze
INSERT INTO "public"."quizzes" ("id", "organization_id", "created_by", "name", "description") VALUES
  ('00000000-0000-4000-8007-000000000001', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Historia — Średniowiecze', 'Quiz z historii Polski dla klasy średniowiecza')
ON CONFLICT DO NOTHING;

INSERT INTO "public"."quiz_questions" ("quiz_id", "question_id", "order_index", "points") VALUES
  ('00000000-0000-4000-8007-000000000001', '00000000-0000-4000-8030-000000000005', 0, 1),
  ('00000000-0000-4000-8007-000000000001', '00000000-0000-4000-8030-000000000006', 1, 1),
  ('00000000-0000-4000-8007-000000000001', '00000000-0000-4000-8030-000000000007', 2, 1),
  ('00000000-0000-4000-8007-000000000001', '00000000-0000-4000-8030-000000000008', 3, 2)
ON CONFLICT DO NOTHING;

-- Quiz 2: Geografia i Nauka
INSERT INTO "public"."quizzes" ("id", "organization_id", "created_by", "name", "description") VALUES
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8000-00000000000F', '00000000-0000-4000-8001-00000000000A', 'Geografia i Nauka — Odkrycia', 'Quiz z geografii i nauk przyrodniczych')
ON CONFLICT DO NOTHING;

INSERT INTO "public"."quiz_questions" ("quiz_id", "question_id", "order_index", "points") VALUES
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8030-000000000009', 0, 1),
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8030-00000000000A', 1, 1),
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8030-00000000000B', 2, 1),
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8030-00000000000C', 3, 1),
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8030-00000000000D', 4, 2),
  ('00000000-0000-4000-8007-000000000002', '00000000-0000-4000-8030-00000000000E', 5, 2)
ON CONFLICT DO NOTHING;
