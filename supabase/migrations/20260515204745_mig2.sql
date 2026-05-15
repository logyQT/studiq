alter table "public"."flashcard_practice" add column "confidence_level" integer;

alter table "public"."flashcard_practice" add column "response_time_ms" integer;

alter table "public"."flashcard_practice" add column "session_id" uuid;

CREATE INDEX idx_flashcard_practice_session ON public.flashcard_practice USING btree (session_id);

alter table "public"."flashcard_practice" add constraint "flashcard_practice_confidence_level_check" CHECK (((confidence_level IS NULL) OR ((confidence_level >= 1) AND (confidence_level <= 5)))) not valid;

alter table "public"."flashcard_practice" validate constraint "flashcard_practice_confidence_level_check";


