revoke delete on table "public"."flashcard_space_assignments" from "anon";

revoke insert on table "public"."flashcard_space_assignments" from "anon";

revoke references on table "public"."flashcard_space_assignments" from "anon";

revoke select on table "public"."flashcard_space_assignments" from "anon";

revoke trigger on table "public"."flashcard_space_assignments" from "anon";

revoke truncate on table "public"."flashcard_space_assignments" from "anon";

revoke update on table "public"."flashcard_space_assignments" from "anon";

revoke delete on table "public"."flashcard_space_assignments" from "authenticated";

revoke insert on table "public"."flashcard_space_assignments" from "authenticated";

revoke references on table "public"."flashcard_space_assignments" from "authenticated";

revoke select on table "public"."flashcard_space_assignments" from "authenticated";

revoke trigger on table "public"."flashcard_space_assignments" from "authenticated";

revoke truncate on table "public"."flashcard_space_assignments" from "authenticated";

revoke update on table "public"."flashcard_space_assignments" from "authenticated";

revoke delete on table "public"."flashcard_space_assignments" from "service_role";

revoke insert on table "public"."flashcard_space_assignments" from "service_role";

revoke references on table "public"."flashcard_space_assignments" from "service_role";

revoke select on table "public"."flashcard_space_assignments" from "service_role";

revoke trigger on table "public"."flashcard_space_assignments" from "service_role";

revoke truncate on table "public"."flashcard_space_assignments" from "service_role";

revoke update on table "public"."flashcard_space_assignments" from "service_role";

revoke delete on table "public"."flashcard_spaces" from "anon";

revoke insert on table "public"."flashcard_spaces" from "anon";

revoke references on table "public"."flashcard_spaces" from "anon";

revoke select on table "public"."flashcard_spaces" from "anon";

revoke trigger on table "public"."flashcard_spaces" from "anon";

revoke truncate on table "public"."flashcard_spaces" from "anon";

revoke update on table "public"."flashcard_spaces" from "anon";

revoke delete on table "public"."flashcard_spaces" from "authenticated";

revoke insert on table "public"."flashcard_spaces" from "authenticated";

revoke references on table "public"."flashcard_spaces" from "authenticated";

revoke select on table "public"."flashcard_spaces" from "authenticated";

revoke trigger on table "public"."flashcard_spaces" from "authenticated";

revoke truncate on table "public"."flashcard_spaces" from "authenticated";

revoke update on table "public"."flashcard_spaces" from "authenticated";

revoke delete on table "public"."flashcard_spaces" from "service_role";

revoke insert on table "public"."flashcard_spaces" from "service_role";

revoke references on table "public"."flashcard_spaces" from "service_role";

revoke select on table "public"."flashcard_spaces" from "service_role";

revoke trigger on table "public"."flashcard_spaces" from "service_role";

revoke truncate on table "public"."flashcard_spaces" from "service_role";

revoke update on table "public"."flashcard_spaces" from "service_role";

alter table "public"."flashcard_space_assignments" drop constraint "flashcard_space_assignments_flashcard_id_fkey";

alter table "public"."flashcard_space_assignments" drop constraint "flashcard_space_assignments_space_id_fkey";

alter table "public"."flashcard_spaces" drop constraint "flashcard_spaces_created_by_fkey";

alter table "public"."flashcard_spaces" drop constraint "flashcard_spaces_university_id_fkey";

alter table "public"."flashcard_space_assignments" drop constraint "flashcard_space_assignments_pkey";

alter table "public"."flashcard_spaces" drop constraint "flashcard_spaces_pkey";

drop index if exists "public"."flashcard_space_assignments_pkey";

drop index if exists "public"."flashcard_spaces_pkey";

drop index if exists "public"."idx_flashcard_space_assignments_space";

drop index if exists "public"."idx_flashcard_spaces_created_by";

drop index if exists "public"."idx_flashcard_spaces_university";

drop table "public"."flashcard_space_assignments";

drop table "public"."flashcard_spaces";


  create table "public"."flashcard_deck_assignments" (
    "flashcard_id" uuid not null,
    "deck_id" uuid not null
      );



  create table "public"."flashcard_decks" (
    "id" uuid not null default gen_random_uuid(),
    "university_id" uuid,
    "created_by" uuid,
    "name" text not null,
    "description" text,
    "created_at" timestamp with time zone default now()
      );


CREATE UNIQUE INDEX flashcard_deck_assignments_pkey ON public.flashcard_deck_assignments USING btree (flashcard_id, deck_id);

CREATE UNIQUE INDEX flashcard_decks_pkey ON public.flashcard_decks USING btree (id);

CREATE INDEX idx_flashcard_deck_assignments_deck ON public.flashcard_deck_assignments USING btree (deck_id);

CREATE INDEX idx_flashcard_decks_created_by ON public.flashcard_decks USING btree (created_by);

CREATE INDEX idx_flashcard_decks_university ON public.flashcard_decks USING btree (university_id);

alter table "public"."flashcard_deck_assignments" add constraint "flashcard_deck_assignments_pkey" PRIMARY KEY using index "flashcard_deck_assignments_pkey";

alter table "public"."flashcard_decks" add constraint "flashcard_decks_pkey" PRIMARY KEY using index "flashcard_decks_pkey";

alter table "public"."flashcard_deck_assignments" add constraint "flashcard_deck_assignments_deck_id_fkey" FOREIGN KEY (deck_id) REFERENCES public.flashcard_decks(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_deck_assignments" validate constraint "flashcard_deck_assignments_deck_id_fkey";

alter table "public"."flashcard_deck_assignments" add constraint "flashcard_deck_assignments_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_deck_assignments" validate constraint "flashcard_deck_assignments_flashcard_id_fkey";

alter table "public"."flashcard_decks" add constraint "flashcard_decks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_decks" validate constraint "flashcard_decks_created_by_fkey";

alter table "public"."flashcard_decks" add constraint "flashcard_decks_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE SET NULL not valid;

alter table "public"."flashcard_decks" validate constraint "flashcard_decks_university_id_fkey";

grant delete on table "public"."flashcard_deck_assignments" to "anon";

grant insert on table "public"."flashcard_deck_assignments" to "anon";

grant references on table "public"."flashcard_deck_assignments" to "anon";

grant select on table "public"."flashcard_deck_assignments" to "anon";

grant trigger on table "public"."flashcard_deck_assignments" to "anon";

grant truncate on table "public"."flashcard_deck_assignments" to "anon";

grant update on table "public"."flashcard_deck_assignments" to "anon";

grant delete on table "public"."flashcard_deck_assignments" to "authenticated";

grant insert on table "public"."flashcard_deck_assignments" to "authenticated";

grant references on table "public"."flashcard_deck_assignments" to "authenticated";

grant select on table "public"."flashcard_deck_assignments" to "authenticated";

grant trigger on table "public"."flashcard_deck_assignments" to "authenticated";

grant truncate on table "public"."flashcard_deck_assignments" to "authenticated";

grant update on table "public"."flashcard_deck_assignments" to "authenticated";

grant delete on table "public"."flashcard_deck_assignments" to "service_role";

grant insert on table "public"."flashcard_deck_assignments" to "service_role";

grant references on table "public"."flashcard_deck_assignments" to "service_role";

grant select on table "public"."flashcard_deck_assignments" to "service_role";

grant trigger on table "public"."flashcard_deck_assignments" to "service_role";

grant truncate on table "public"."flashcard_deck_assignments" to "service_role";

grant update on table "public"."flashcard_deck_assignments" to "service_role";

grant delete on table "public"."flashcard_decks" to "anon";

grant insert on table "public"."flashcard_decks" to "anon";

grant references on table "public"."flashcard_decks" to "anon";

grant select on table "public"."flashcard_decks" to "anon";

grant trigger on table "public"."flashcard_decks" to "anon";

grant truncate on table "public"."flashcard_decks" to "anon";

grant update on table "public"."flashcard_decks" to "anon";

grant delete on table "public"."flashcard_decks" to "authenticated";

grant insert on table "public"."flashcard_decks" to "authenticated";

grant references on table "public"."flashcard_decks" to "authenticated";

grant select on table "public"."flashcard_decks" to "authenticated";

grant trigger on table "public"."flashcard_decks" to "authenticated";

grant truncate on table "public"."flashcard_decks" to "authenticated";

grant update on table "public"."flashcard_decks" to "authenticated";

grant delete on table "public"."flashcard_decks" to "service_role";

grant insert on table "public"."flashcard_decks" to "service_role";

grant references on table "public"."flashcard_decks" to "service_role";

grant select on table "public"."flashcard_decks" to "service_role";

grant trigger on table "public"."flashcard_decks" to "service_role";

grant truncate on table "public"."flashcard_decks" to "service_role";

grant update on table "public"."flashcard_decks" to "service_role";


