-- ==========================================================
-- Seeds: users (01)
-- Creates: university, auth users, identities, profile roles
-- Password for all accounts: pass
-- ==========================================================

-- ----------------------------------------------------------
-- Test organization
-- ----------------------------------------------------------
INSERT INTO "public"."organizations" ("id", "name", "slug") VALUES
  ('00000000-0000-4000-8000-000000000001', 'Dev University', 'dev-university'),
  ('00000000-0000-4000-8000-000000000002', 'Politechnika Warszawska', 'politechnika-warszawska'),
  ('00000000-0000-4000-8000-000000000003', 'Uniwersytet Jagielloński', 'uniwersytet-jagiellonski'),
  ('00000000-0000-4000-8000-000000000004', 'Politechnika Gdańska', 'politechnika-gdanska'),
  ('00000000-0000-4000-8000-000000000005', 'Uniwersytet Wrocławski', 'uniwersytet-wroclawski'),
  ('00000000-0000-4000-8000-000000000006', 'Akademia Górniczo-Hutnicza', 'akademia-gorniczo-hutnicza')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- Organization subscriptions
-- ----------------------------------------------------------
INSERT INTO "public"."org_subscriptions" ("organization_id", "plan_type", "status") VALUES
  ('00000000-0000-4000-8000-000000000001', 'enterprise', 'active'),
  ('00000000-0000-4000-8000-000000000002', 'enterprise', 'active'),
  ('00000000-0000-4000-8000-000000000003', 'pro', 'active'),
  ('00000000-0000-4000-8000-000000000004', 'pro', 'active'),
  ('00000000-0000-4000-8000-000000000005', 'basic', 'active'),
  ('00000000-0000-4000-8000-000000000006', 'basic', 'active')
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
    '00000000-0000-4000-8001-000000000001',
    'authenticated', 'authenticated', 'admin@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "sys_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "Sys Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000002',
    'authenticated', 'authenticated', 'uadmin@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "University Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000003',
    'authenticated', 'authenticated', 'teacher@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- student
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000004',
    'authenticated', 'authenticated', 'student@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "Student", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- premium
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000005',
    'authenticated', 'authenticated', 'premium@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "premium", "provider": "email", "providers": ["email"]}',
    '{"name": "Premium User", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- free
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000006',
    'authenticated', 'authenticated', 'user@dev.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "free", "provider": "email", "providers": ["email"]}',
    '{"name": "Free User", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- ==========================================================
  -- Politechnika Warszawska
  -- ==========================================================

  -- pw: university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000007',
    'authenticated', 'authenticated', 'pw-admin@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "PW Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- pw: teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000008',
    'authenticated', 'authenticated', 'pw-teacher@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "PW Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- pw: student
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000009',
    'authenticated', 'authenticated', 'pw-student@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "PW Student", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- ==========================================================
  -- Uniwersytet Jagielloński
  -- ==========================================================

  -- uj: university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000010',
    'authenticated', 'authenticated', 'uj-admin@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "UJ Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- uj: teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000011',
    'authenticated', 'authenticated', 'uj-teacher@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "UJ Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- uj: student 1
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000012',
    'authenticated', 'authenticated', 'uj-student1@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "UJ Student 1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- uj: student 2
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000013',
    'authenticated', 'authenticated', 'uj-student2@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "UJ Student 2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- ==========================================================
  -- Politechnika Gdańska
  -- ==========================================================

  -- pg: university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000014',
    'authenticated', 'authenticated', 'pg-admin@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "PG Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- pg: teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000015',
    'authenticated', 'authenticated', 'pg-teacher@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "PG Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- pg: student 1
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000016',
    'authenticated', 'authenticated', 'pg-student1@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "PG Student 1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- pg: student 2
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000017',
    'authenticated', 'authenticated', 'pg-student2@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "PG Student 2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- ==========================================================
  -- Uniwersytet Wrocławski
  -- ==========================================================

  -- uwr: university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000018',
    'authenticated', 'authenticated', 'uwr-admin@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "UWR Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- uwr: teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000019',
    'authenticated', 'authenticated', 'uwr-teacher@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "UWR Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- uwr: student
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000020',
    'authenticated', 'authenticated', 'uwr-student@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "UWR Student", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- ==========================================================
  -- Akademia Górniczo-Hutnicza
  -- ==========================================================

  -- agh: university_admin
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000021',
    'authenticated', 'authenticated', 'agh-admin@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "university_admin", "provider": "email", "providers": ["email"]}',
    '{"name": "AGH Admin", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- agh: teacher
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000022',
    'authenticated', 'authenticated', 'agh-teacher@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "teacher", "provider": "email", "providers": ["email"]}',
    '{"name": "AGH Teacher", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- agh: student 1
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000023',
    'authenticated', 'authenticated', 'agh-student1@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "AGH Student 1", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false ),

  -- agh: student 2
  ( '00000000-0000-0000-0000-000000000000',
    '00000000-0000-4000-8001-000000000024',
    'authenticated', 'authenticated', 'agh-student2@test.local',
    crypt('pass', gen_salt('bf')),
    now(), NULL, '', NULL, '', NULL, '', '', NULL, NULL,
    '{"role": "student", "provider": "email", "providers": ["email"]}',
    '{"name": "AGH Student 2", "email_verified": true}',
    NULL, now(), now(), NULL, NULL, '', '', NULL, '', 0, NULL, '', NULL, false, NULL, false )

ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------
-- Auth identities (required for signInWithPassword)
-- ----------------------------------------------------------
INSERT INTO "auth"."identities" (
  "provider_id", "user_id", "identity_data", "provider",
  "last_sign_in_at", "created_at", "updated_at", "id"
) VALUES
  ( '00000000-0000-4000-8001-000000000001',
    '00000000-0000-4000-8001-000000000001',
    '{"sub": "00000000-0000-4000-8001-000000000001", "email": "admin@dev.local",   "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000001' ),

  ( '00000000-0000-4000-8001-000000000002',
    '00000000-0000-4000-8001-000000000002',
    '{"sub": "00000000-0000-4000-8001-000000000002", "email": "uadmin@dev.local",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000002' ),

  ( '00000000-0000-4000-8001-000000000003',
    '00000000-0000-4000-8001-000000000003',
    '{"sub": "00000000-0000-4000-8001-000000000003", "email": "teacher@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000003' ),

  ( '00000000-0000-4000-8001-000000000004',
    '00000000-0000-4000-8001-000000000004',
    '{"sub": "00000000-0000-4000-8001-000000000004", "email": "student@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000004' ),

  ( '00000000-0000-4000-8001-000000000005',
    '00000000-0000-4000-8001-000000000005',
    '{"sub": "00000000-0000-4000-8001-000000000005", "email": "premium@dev.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000005' ),

  ( '00000000-0000-4000-8001-000000000006',
    '00000000-0000-4000-8001-000000000006',
    '{"sub": "00000000-0000-4000-8001-000000000006", "email": "user@dev.local",    "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000006' ),

  -- PW
  ( '00000000-0000-4000-8001-000000000007',
    '00000000-0000-4000-8001-000000000007',
    '{"sub": "00000000-0000-4000-8001-000000000007", "email": "pw-admin@test.local",   "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000007' ),

  ( '00000000-0000-4000-8001-000000000008',
    '00000000-0000-4000-8001-000000000008',
    '{"sub": "00000000-0000-4000-8001-000000000008", "email": "pw-teacher@test.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000008' ),

  ( '00000000-0000-4000-8001-000000000009',
    '00000000-0000-4000-8001-000000000009',
    '{"sub": "00000000-0000-4000-8001-000000000009", "email": "pw-student@test.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000009' ),

  -- UJ
  ( '00000000-0000-4000-8001-000000000010',
    '00000000-0000-4000-8001-000000000010',
    '{"sub": "00000000-0000-4000-8001-000000000010", "email": "uj-admin@test.local",   "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000010' ),

  ( '00000000-0000-4000-8001-000000000011',
    '00000000-0000-4000-8001-000000000011',
    '{"sub": "00000000-0000-4000-8001-000000000011", "email": "uj-teacher@test.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000011' ),

  ( '00000000-0000-4000-8001-000000000012',
    '00000000-0000-4000-8001-000000000012',
    '{"sub": "00000000-0000-4000-8001-000000000012", "email": "uj-student1@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000012' ),

  ( '00000000-0000-4000-8001-000000000013',
    '00000000-0000-4000-8001-000000000013',
    '{"sub": "00000000-0000-4000-8001-000000000013", "email": "uj-student2@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000013' ),

  -- PG
  ( '00000000-0000-4000-8001-000000000014',
    '00000000-0000-4000-8001-000000000014',
    '{"sub": "00000000-0000-4000-8001-000000000014", "email": "pg-admin@test.local",   "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000014' ),

  ( '00000000-0000-4000-8001-000000000015',
    '00000000-0000-4000-8001-000000000015',
    '{"sub": "00000000-0000-4000-8001-000000000015", "email": "pg-teacher@test.local", "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000015' ),

  ( '00000000-0000-4000-8001-000000000016',
    '00000000-0000-4000-8001-000000000016',
    '{"sub": "00000000-0000-4000-8001-000000000016", "email": "pg-student1@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000016' ),

  ( '00000000-0000-4000-8001-000000000017',
    '00000000-0000-4000-8001-000000000017',
    '{"sub": "00000000-0000-4000-8001-000000000017", "email": "pg-student2@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000017' ),

  -- UWR
  ( '00000000-0000-4000-8001-000000000018',
    '00000000-0000-4000-8001-000000000018',
    '{"sub": "00000000-0000-4000-8001-000000000018", "email": "uwr-admin@test.local",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000018' ),

  ( '00000000-0000-4000-8001-000000000019',
    '00000000-0000-4000-8001-000000000019',
    '{"sub": "00000000-0000-4000-8001-000000000019", "email": "uwr-teacher@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000019' ),

  ( '00000000-0000-4000-8001-000000000020',
    '00000000-0000-4000-8001-000000000020',
    '{"sub": "00000000-0000-4000-8001-000000000020", "email": "uwr-student@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000020' ),

  -- AGH
  ( '00000000-0000-4000-8001-000000000021',
    '00000000-0000-4000-8001-000000000021',
    '{"sub": "00000000-0000-4000-8001-000000000021", "email": "agh-admin@test.local",  "email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000021' ),

  ( '00000000-0000-4000-8001-000000000022',
    '00000000-0000-4000-8001-000000000022',
    '{"sub": "00000000-0000-4000-8001-000000000022", "email": "agh-teacher@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000022' ),

  ( '00000000-0000-4000-8001-000000000023',
    '00000000-0000-4000-8001-000000000023',
    '{"sub": "00000000-0000-4000-8001-000000000023", "email": "agh-student1@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000023' ),

  ( '00000000-0000-4000-8001-000000000024',
    '00000000-0000-4000-8001-000000000024',
    '{"sub": "00000000-0000-4000-8001-000000000024", "email": "agh-student2@test.local","email_verified": true, "phone_verified": false}',
    'email', now(), now(), now(),
    '00000000-0000-4000-8002-000000000024' )

ON CONFLICT DO NOTHING;


-- ----------------------------------------------------------
-- Fix roles + university links on profiles
-- Trigger created them all as 'free'; patch here.
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'sys_admin'
  WHERE id = '00000000-0000-4000-8001-000000000001';

UPDATE public.profiles SET role = 'university_admin', organization_id = '00000000-0000-4000-8000-000000000001'
  WHERE id = '00000000-0000-4000-8001-000000000002';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000002', 'university_admin')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'teacher', organization_id = '00000000-0000-4000-8000-000000000001'
  WHERE id = '00000000-0000-4000-8001-000000000003';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000003', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000001'
  WHERE id = '00000000-0000-4000-8001-000000000004';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8001-000000000004', 'student')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'premium'
  WHERE id = '00000000-0000-4000-8001-000000000005';

-- '00000000-0000-4000-8001-000000000006' stays 'free'

-- ----------------------------------------------------------
-- PW: assign roles + university
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'university_admin', organization_id = '00000000-0000-4000-8000-000000000002'
  WHERE id = '00000000-0000-4000-8001-000000000007';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000007', 'university_admin')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'teacher', organization_id = '00000000-0000-4000-8000-000000000002'
  WHERE id = '00000000-0000-4000-8001-000000000008';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000008', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000002'
  WHERE id = '00000000-0000-4000-8001-000000000009';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8001-000000000009', 'student')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- UJ: assign roles + university
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'university_admin', organization_id = '00000000-0000-4000-8000-000000000003'
  WHERE id = '00000000-0000-4000-8001-000000000010';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000010', 'university_admin')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'teacher', organization_id = '00000000-0000-4000-8000-000000000003'
  WHERE id = '00000000-0000-4000-8001-000000000011';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000011', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000003'
  WHERE id = '00000000-0000-4000-8001-000000000012';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000012', 'student')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000003'
  WHERE id = '00000000-0000-4000-8001-000000000013';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8001-000000000013', 'student')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- PG: assign roles + university
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'university_admin', organization_id = '00000000-0000-4000-8000-000000000004'
  WHERE id = '00000000-0000-4000-8001-000000000014';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000014', 'university_admin')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'teacher', organization_id = '00000000-0000-4000-8000-000000000004'
  WHERE id = '00000000-0000-4000-8001-000000000015';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000015', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000004'
  WHERE id = '00000000-0000-4000-8001-000000000016';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000016', 'student')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000004'
  WHERE id = '00000000-0000-4000-8001-000000000017';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8001-000000000017', 'student')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- UWR: assign roles + university
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'university_admin', organization_id = '00000000-0000-4000-8000-000000000005'
  WHERE id = '00000000-0000-4000-8001-000000000018';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000018', 'university_admin')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'teacher', organization_id = '00000000-0000-4000-8000-000000000005'
  WHERE id = '00000000-0000-4000-8001-000000000019';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000019', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000005'
  WHERE id = '00000000-0000-4000-8001-000000000020';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8001-000000000020', 'student')
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------
-- AGH: assign roles + university
-- ----------------------------------------------------------
UPDATE public.profiles SET role = 'university_admin', organization_id = '00000000-0000-4000-8000-000000000006'
  WHERE id = '00000000-0000-4000-8001-000000000021';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000021', 'university_admin')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'teacher', organization_id = '00000000-0000-4000-8000-000000000006'
  WHERE id = '00000000-0000-4000-8001-000000000022';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000022', 'teacher')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000006'
  WHERE id = '00000000-0000-4000-8001-000000000023';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000023', 'student')
ON CONFLICT DO NOTHING;

UPDATE public.profiles SET role = 'student', organization_id = '00000000-0000-4000-8000-000000000006'
  WHERE id = '00000000-0000-4000-8001-000000000024';

INSERT INTO public.org_members (organization_id, user_id, role) VALUES
  ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8001-000000000024', 'student')
ON CONFLICT DO NOTHING;
