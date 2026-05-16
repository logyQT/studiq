-- ==========================================================
-- Seeds: flashcard_spaces + flashcard_space_assignments (07)
-- Depends on: 05_flashcards.sql, 01_users.sql
-- ==========================================================

-- Flashcard spaces (owned by student user)
INSERT INTO "public"."flashcard_spaces" ("id", "created_by", "name", "description", "created_at") VALUES
  ('00000000-0000-4000-8012-000000000001', '00000000-0000-4000-8001-000000000004', 'JS Exam Prep', 'Flashcards for JavaScript exam', now()),
  ('00000000-0000-4000-8012-000000000002', '00000000-0000-4000-8001-000000000004', 'Quick Review', 'Fast review cards', now())
ON CONFLICT DO NOTHING;

-- Space 1: JS Exam Prep gets the 2 JS flashcards
INSERT INTO "public"."flashcard_space_assignments" ("flashcard_id", "space_id") VALUES
  ('00000000-0000-4000-8006-000000000001', '00000000-0000-4000-8012-000000000001'),
  ('00000000-0000-4000-8006-000000000002', '00000000-0000-4000-8012-000000000001')
ON CONFLICT DO NOTHING;

-- Space 2: Quick Review gets the SQL flashcard
INSERT INTO "public"."flashcard_space_assignments" ("flashcard_id", "space_id") VALUES
  ('00000000-0000-4000-8006-000000000003', '00000000-0000-4000-8012-000000000002')
ON CONFLICT DO NOTHING;
