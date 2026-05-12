-- ==========================================================
-- Seeds: subjects (02)
-- Depends on: 01_users.sql
-- ==========================================================

INSERT INTO "public"."subjects" ("id", "university_id", "name", "description", "created_by", "created_at") VALUES
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-000000000001', 'Programowanie', 'Podstawy programowania w JavaScript', '00000000-0000-0000-0001-000000000003', now()),
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-000000000001', 'Bazy Danych', 'SQL i projektowanie baz danych', '00000000-0000-0000-0001-000000000003', now()),
  ('00000000-0000-0000-0003-000000000003', NULL, 'Matematyka', 'Analiza i algebra liniowa', '00000000-0000-0000-0001-000000000006', now())
ON CONFLICT DO NOTHING;
