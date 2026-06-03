
  create table "public"."flashcard_review_state" (
    "user_id" uuid not null,
    "flashcard_id" uuid not null,
    "easiness_factor" real not null default 2.5,
    "interval_days" integer not null default 0,
    "repetitions" integer not null default 0,
    "next_review_at" timestamp with time zone not null default now(),
    "last_reviewed_at" timestamp with time zone,
    "last_quality" smallint
      );


CREATE UNIQUE INDEX flashcard_review_state_pkey ON public.flashcard_review_state USING btree (user_id, flashcard_id);

CREATE INDEX idx_flashcard_review_state_next_review ON public.flashcard_review_state USING btree (user_id, next_review_at);

alter table "public"."flashcard_review_state" add constraint "flashcard_review_state_pkey" PRIMARY KEY using index "flashcard_review_state_pkey";

alter table "public"."flashcard_review_state" add constraint "flashcard_review_state_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_review_state" validate constraint "flashcard_review_state_flashcard_id_fkey";

alter table "public"."flashcard_review_state" add constraint "flashcard_review_state_last_quality_check" CHECK (((last_quality IS NULL) OR ((last_quality >= 0) AND (last_quality <= 5)))) not valid;

alter table "public"."flashcard_review_state" validate constraint "flashcard_review_state_last_quality_check";

alter table "public"."flashcard_review_state" add constraint "flashcard_review_state_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_review_state" validate constraint "flashcard_review_state_user_id_fkey";

grant delete on table "public"."flashcard_review_state" to "anon";

grant insert on table "public"."flashcard_review_state" to "anon";

grant references on table "public"."flashcard_review_state" to "anon";

grant select on table "public"."flashcard_review_state" to "anon";

grant trigger on table "public"."flashcard_review_state" to "anon";

grant truncate on table "public"."flashcard_review_state" to "anon";

grant update on table "public"."flashcard_review_state" to "anon";

grant delete on table "public"."flashcard_review_state" to "authenticated";

grant insert on table "public"."flashcard_review_state" to "authenticated";

grant references on table "public"."flashcard_review_state" to "authenticated";

grant select on table "public"."flashcard_review_state" to "authenticated";

grant trigger on table "public"."flashcard_review_state" to "authenticated";

grant truncate on table "public"."flashcard_review_state" to "authenticated";

grant update on table "public"."flashcard_review_state" to "authenticated";

grant delete on table "public"."flashcard_review_state" to "service_role";

grant insert on table "public"."flashcard_review_state" to "service_role";

grant references on table "public"."flashcard_review_state" to "service_role";

grant select on table "public"."flashcard_review_state" to "service_role";

grant trigger on table "public"."flashcard_review_state" to "service_role";

grant truncate on table "public"."flashcard_review_state" to "service_role";

grant update on table "public"."flashcard_review_state" to "service_role";


