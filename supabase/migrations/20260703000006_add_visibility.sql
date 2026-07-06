-- ==========================================
-- Migration: Add visibility column to content tables
-- Phase 9: Content org-scoping with visibility
-- ==========================================

CREATE TYPE visibility_type AS ENUM ('personal', 'org');

ALTER TABLE flashcards ADD COLUMN visibility visibility_type NOT NULL DEFAULT 'personal';
ALTER TABLE flashcard_decks ADD COLUMN visibility visibility_type NOT NULL DEFAULT 'personal';
ALTER TABLE question_banks ADD COLUMN visibility visibility_type NOT NULL DEFAULT 'personal';
ALTER TABLE questions ADD COLUMN visibility visibility_type NOT NULL DEFAULT 'personal';
ALTER TABLE topics ADD COLUMN visibility visibility_type NOT NULL DEFAULT 'personal';

CREATE INDEX idx_flashcards_visibility ON flashcards(organization_id, visibility);
CREATE INDEX idx_flashcard_decks_visibility ON flashcard_decks(organization_id, visibility);
CREATE INDEX idx_questions_visibility ON questions(organization_id, visibility);
CREATE INDEX idx_question_banks_visibility ON question_banks(organization_id, visibility);
CREATE INDEX idx_topics_visibility ON topics(organization_id, visibility);
