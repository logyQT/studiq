-- ==========================================================
-- Seeds: users (01)
-- Creates: university, auth users, identities, profile roles
-- Password for all accounts: pass
-- ==========================================================

-- ----------------------------------------------------------
-- Test university
-- ----------------------------------------------------------
INSERT INTO "public"."universities" ("id", "name", "slug") VALUES
  ('00000000-0000-0000-0000-000000000001', 'Dev University', 'dev-university')
ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------
-- Auth users
-- ----------------------------------------------------------
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
  -- sys_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0001-000000000001',
    'authenticated', 'authenticated', 'admin@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "sys_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "Sys Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0001-000000000002',
    'authenticated', 'authenticated', 'uadmin@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "University Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0001-000000000003',
    'authenticated', 'authenticated', 'teacher@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- student
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0001-000000000004',
    'authenticated', 'authenticated', 'student@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- premium
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0001-000000000005',
    'authenticated', 'authenticated', 'premium@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "premium", "provider": "email", "providers": ["email"]}',
    '{"name": "Premium User", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- free
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-0000-0001-000000000006',
    'authenticated', 'authenticated', 'user@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "free", "provider": "email", "providers": ["email"]}',
    '{"name": "Free User", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false )

ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------
-- Auth identities (required for signInWithPassword)
-- ----------------------------------------------------------
INSERT INTO "auth"."identities" (
  "provider_id", "user_id", "identity_data", "provider",
  "last_sign_in_at", "created_at", "updated_at", "id"
) VALUES
  ( '00000000-0000-0000-0001-000000000001',
    '00000000-0000-0000-0001-000000000001',
    '{"sub": "00000000-0000-0000-0001-000000000001", "email": "admin@dev.local",   "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-0000-0002-000000000001' ),

  ( '00000000-0000-0000-0001-000000000002',
    '00000000-0000-0000-0001-000000000002',
    '{"sub": "00000000-0000-0000-0001-000000000002", "email": "uadmin@dev.local",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-0000-0002-000000000002' ),

  ( '00000000-0000-0000-0001-000000000003',
    '00000000-0000-0000-0001-000000000003',
    '{"sub": "00000000-0000-0000-0001-000000000003", "email": "teacher@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-0000-0002-000000000003' ),

  ( '00000000-0000-0000-0001-000000000004',
    '00000000-0000-0000-0001-000000000004',
    '{"sub": "00000000-0000-0000-0001-000000000004", "email": "student@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-0000-0002-000000000004' ),

  ( '00000000-0000-0000-0001-000000000005',
    '00000000-0000-0000-0001-000000000005',
    '{"sub": "00000000-0000-0000-0001-000000000005", "email": "premium@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-0000-0002-000000000005' ),

  ( '00000000-0000-0000-0001-000000000006',
    '00000000-0000-0000-0001-000000000006',
    '{"sub": "00000000-0000-0000-0001-000000000006", "email": "user@dev.local",    "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-0000-0002-000000000006' )

ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------
-- Fix roles + university links on profiles
-- Trigger created them all as 'free'; patch here.
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'sys_admin'
  WHERE id = '00000000-0000-0000-0001-000000000001';

UPDATE public.profiles SET role = 'university_admin', university_id = '00000000-0000-0000-0000-000000000001'
  WHERE id = '00000000-0000-0000-0001-000000000002';

UPDATE public.profiles SET role = 'teacher', university_id = '00000000-0000-0000-0000-000000000001'
  WHERE id = '00000000-0000-0000-0001-000000000003';

UPDATE public.profiles SET role = 'student', university_id = '00000000-0000-0000-0000-000000000001'
  WHERE id = '00000000-0000-0000-0001-000000000004';

UPDATE public.profiles SET role = 'premium'
  WHERE id = '00000000-0000-0000-0001-000000000005';

-- '00000000-0000-0000-0001-000000000006' stays 'free'
