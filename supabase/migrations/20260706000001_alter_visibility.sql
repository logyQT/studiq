-- ==========================================
-- Migration: 20260706000001
-- Description: Add is_default to groups, alter visibility enum
-- Phase: P2 — Content scoping by group
-- ==========================================

-- Add is_default column to groups
ALTER TABLE public.groups ADD COLUMN is_default boolean NOT NULL DEFAULT false;
CREATE UNIQUE INDEX idx_groups_one_default_per_org ON public.groups(organization_id) WHERE is_default = true;

-- Drop functions that depend on visibility_type before renaming
DROP FUNCTION IF EXISTS public.bulk_create_flashcards(jsonb, uuid, uuid, visibility_type, uuid[], uuid[]);

-- Alter visibility enum: personal, org -> personal, group
ALTER TYPE visibility_type RENAME TO visibility_type_old;
CREATE TYPE visibility_type AS ENUM ('personal', 'group');

-- === flashcard_decks ===
ALTER TABLE public.flashcard_decks ALTER COLUMN visibility DROP DEFAULT;
ALTER TABLE public.flashcard_decks
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);
ALTER TABLE public.flashcard_decks ALTER COLUMN visibility SET DEFAULT 'personal';

-- === flashcards ===
ALTER TABLE public.flashcards ALTER COLUMN visibility DROP DEFAULT;
ALTER TABLE public.flashcards
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);
ALTER TABLE public.flashcards ALTER COLUMN visibility SET DEFAULT 'personal';

-- === question_banks ===
ALTER TABLE public.question_banks ALTER COLUMN visibility DROP DEFAULT;
ALTER TABLE public.question_banks
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);
ALTER TABLE public.question_banks ALTER COLUMN visibility SET DEFAULT 'personal';

-- === questions ===
ALTER TABLE public.questions ALTER COLUMN visibility DROP DEFAULT;
ALTER TABLE public.questions
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);
ALTER TABLE public.questions ALTER COLUMN visibility SET DEFAULT 'personal';

-- === topics ===
ALTER TABLE public.topics ALTER COLUMN visibility DROP DEFAULT;
ALTER TABLE public.topics
  ALTER COLUMN visibility TYPE visibility_type
  USING (CASE WHEN visibility = 'org' THEN 'group' ELSE 'personal'::text END::visibility_type);
ALTER TABLE public.topics ALTER COLUMN visibility SET DEFAULT 'personal';

-- Recreate functions that reference the old visibility_type
CREATE OR REPLACE FUNCTION public.bulk_create_flashcards(
  p_cards jsonb,
  p_user_id uuid,
  p_organization_id uuid DEFAULT NULL,
  p_visibility visibility_type DEFAULT 'personal',
  p_deck_ids uuid[] DEFAULT '{}'::uuid[],
  p_topic_ids uuid[] DEFAULT '{}'::uuid[]
)
 RETURNS SETOF public.flashcards
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ids UUID[];
BEGIN
  WITH ins AS (
    INSERT INTO flashcards (front, back, created_by, organization_id, visibility)
    SELECT c->>'front', c->>'back', p_user_id, p_organization_id, p_visibility
    FROM jsonb_array_elements(p_cards) AS c
    RETURNING id
  )
  SELECT array_agg(id) INTO v_ids FROM ins;

  IF array_length(p_topic_ids, 1) > 0 THEN
    INSERT INTO flashcard_topic_assignments (flashcard_id, topic_id)
    SELECT id, unnest(p_topic_ids) FROM unnest(v_ids) AS id;
  END IF;

  IF array_length(p_deck_ids, 1) > 0 THEN
    INSERT INTO flashcard_deck_assignments (flashcard_id, deck_id)
    SELECT id, unnest(p_deck_ids) FROM unnest(v_ids) AS id;
  END IF;

  RETURN QUERY SELECT * FROM flashcards WHERE id = ANY(v_ids);
END;
$function$;

DROP TYPE visibility_type_old;
