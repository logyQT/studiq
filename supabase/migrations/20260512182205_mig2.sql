alter table "public"."flashcards" drop constraint "flashcards_subject_id_fkey";

drop index if exists "public"."idx_flashcards_subject";


  create table "public"."flashcard_space_assignments" (
    "flashcard_id" uuid not null,
    "space_id" uuid not null
      );



  create table "public"."flashcard_spaces" (
    "id" uuid not null default gen_random_uuid(),
    "created_by" uuid,
    "name" text not null,
    "description" text,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."flashcard_topic_assignments" (
    "flashcard_id" uuid not null,
    "topic_id" uuid not null
      );



  create table "public"."flashcard_topics" (
    "id" uuid not null default gen_random_uuid(),
    "university_id" uuid,
    "name" text not null,
    "created_by" uuid,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."flashcards" drop column "subject_id";

CREATE UNIQUE INDEX flashcard_space_assignments_pkey ON public.flashcard_space_assignments USING btree (flashcard_id, space_id);

CREATE UNIQUE INDEX flashcard_spaces_pkey ON public.flashcard_spaces USING btree (id);

CREATE UNIQUE INDEX flashcard_topic_assignments_pkey ON public.flashcard_topic_assignments USING btree (flashcard_id, topic_id);

CREATE UNIQUE INDEX flashcard_topics_pkey ON public.flashcard_topics USING btree (id);

CREATE INDEX idx_flashcard_space_assignments_space ON public.flashcard_space_assignments USING btree (space_id);

CREATE INDEX idx_flashcard_spaces_created_by ON public.flashcard_spaces USING btree (created_by);

CREATE INDEX idx_flashcard_topic_assignments_topic ON public.flashcard_topic_assignments USING btree (topic_id);

CREATE INDEX idx_flashcard_topics_created_by ON public.flashcard_topics USING btree (created_by);

CREATE INDEX idx_flashcard_topics_university ON public.flashcard_topics USING btree (university_id);

alter table "public"."flashcard_space_assignments" add constraint "flashcard_space_assignments_pkey" PRIMARY KEY using index "flashcard_space_assignments_pkey";

alter table "public"."flashcard_spaces" add constraint "flashcard_spaces_pkey" PRIMARY KEY using index "flashcard_spaces_pkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_pkey" PRIMARY KEY using index "flashcard_topic_assignments_pkey";

alter table "public"."flashcard_topics" add constraint "flashcard_topics_pkey" PRIMARY KEY using index "flashcard_topics_pkey";

alter table "public"."flashcard_space_assignments" add constraint "flashcard_space_assignments_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_space_assignments" validate constraint "flashcard_space_assignments_flashcard_id_fkey";

alter table "public"."flashcard_space_assignments" add constraint "flashcard_space_assignments_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.flashcard_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_space_assignments" validate constraint "flashcard_space_assignments_space_id_fkey";

alter table "public"."flashcard_spaces" add constraint "flashcard_spaces_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_spaces" validate constraint "flashcard_spaces_created_by_fkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topic_assignments" validate constraint "flashcard_topic_assignments_flashcard_id_fkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.flashcard_topics(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topic_assignments" validate constraint "flashcard_topic_assignments_topic_id_fkey";

alter table "public"."flashcard_topics" add constraint "flashcard_topics_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."flashcard_topics" validate constraint "flashcard_topics_created_by_fkey";

alter table "public"."flashcard_topics" add constraint "flashcard_topics_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topics" validate constraint "flashcard_topics_university_id_fkey";

grant delete on table "public"."flashcard_space_assignments" to "anon";

grant insert on table "public"."flashcard_space_assignments" to "anon";

grant references on table "public"."flashcard_space_assignments" to "anon";

grant select on table "public"."flashcard_space_assignments" to "anon";

grant trigger on table "public"."flashcard_space_assignments" to "anon";

grant truncate on table "public"."flashcard_space_assignments" to "anon";

grant update on table "public"."flashcard_space_assignments" to "anon";

grant delete on table "public"."flashcard_space_assignments" to "authenticated";

grant insert on table "public"."flashcard_space_assignments" to "authenticated";

grant references on table "public"."flashcard_space_assignments" to "authenticated";

grant select on table "public"."flashcard_space_assignments" to "authenticated";

grant trigger on table "public"."flashcard_space_assignments" to "authenticated";

grant truncate on table "public"."flashcard_space_assignments" to "authenticated";

grant update on table "public"."flashcard_space_assignments" to "authenticated";

grant delete on table "public"."flashcard_space_assignments" to "service_role";

grant insert on table "public"."flashcard_space_assignments" to "service_role";

grant references on table "public"."flashcard_space_assignments" to "service_role";

grant select on table "public"."flashcard_space_assignments" to "service_role";

grant trigger on table "public"."flashcard_space_assignments" to "service_role";

grant truncate on table "public"."flashcard_space_assignments" to "service_role";

grant update on table "public"."flashcard_space_assignments" to "service_role";

grant delete on table "public"."flashcard_spaces" to "anon";

grant insert on table "public"."flashcard_spaces" to "anon";

grant references on table "public"."flashcard_spaces" to "anon";

grant select on table "public"."flashcard_spaces" to "anon";

grant trigger on table "public"."flashcard_spaces" to "anon";

grant truncate on table "public"."flashcard_spaces" to "anon";

grant update on table "public"."flashcard_spaces" to "anon";

grant delete on table "public"."flashcard_spaces" to "authenticated";

grant insert on table "public"."flashcard_spaces" to "authenticated";

grant references on table "public"."flashcard_spaces" to "authenticated";

grant select on table "public"."flashcard_spaces" to "authenticated";

grant trigger on table "public"."flashcard_spaces" to "authenticated";

grant truncate on table "public"."flashcard_spaces" to "authenticated";

grant update on table "public"."flashcard_spaces" to "authenticated";

grant delete on table "public"."flashcard_spaces" to "service_role";

grant insert on table "public"."flashcard_spaces" to "service_role";

grant references on table "public"."flashcard_spaces" to "service_role";

grant select on table "public"."flashcard_spaces" to "service_role";

grant trigger on table "public"."flashcard_spaces" to "service_role";

grant truncate on table "public"."flashcard_spaces" to "service_role";

grant update on table "public"."flashcard_spaces" to "service_role";

grant delete on table "public"."flashcard_topic_assignments" to "anon";

grant insert on table "public"."flashcard_topic_assignments" to "anon";

grant references on table "public"."flashcard_topic_assignments" to "anon";

grant select on table "public"."flashcard_topic_assignments" to "anon";

grant trigger on table "public"."flashcard_topic_assignments" to "anon";

grant truncate on table "public"."flashcard_topic_assignments" to "anon";

grant update on table "public"."flashcard_topic_assignments" to "anon";

grant delete on table "public"."flashcard_topic_assignments" to "authenticated";

grant insert on table "public"."flashcard_topic_assignments" to "authenticated";

grant references on table "public"."flashcard_topic_assignments" to "authenticated";

grant select on table "public"."flashcard_topic_assignments" to "authenticated";

grant trigger on table "public"."flashcard_topic_assignments" to "authenticated";

grant truncate on table "public"."flashcard_topic_assignments" to "authenticated";

grant update on table "public"."flashcard_topic_assignments" to "authenticated";

grant delete on table "public"."flashcard_topic_assignments" to "service_role";

grant insert on table "public"."flashcard_topic_assignments" to "service_role";

grant references on table "public"."flashcard_topic_assignments" to "service_role";

grant select on table "public"."flashcard_topic_assignments" to "service_role";

grant trigger on table "public"."flashcard_topic_assignments" to "service_role";

grant truncate on table "public"."flashcard_topic_assignments" to "service_role";

grant update on table "public"."flashcard_topic_assignments" to "service_role";

grant delete on table "public"."flashcard_topics" to "anon";

grant insert on table "public"."flashcard_topics" to "anon";

grant references on table "public"."flashcard_topics" to "anon";

grant select on table "public"."flashcard_topics" to "anon";

grant trigger on table "public"."flashcard_topics" to "anon";

grant truncate on table "public"."flashcard_topics" to "anon";

grant update on table "public"."flashcard_topics" to "anon";

grant delete on table "public"."flashcard_topics" to "authenticated";

grant insert on table "public"."flashcard_topics" to "authenticated";

grant references on table "public"."flashcard_topics" to "authenticated";

grant select on table "public"."flashcard_topics" to "authenticated";

grant trigger on table "public"."flashcard_topics" to "authenticated";

grant truncate on table "public"."flashcard_topics" to "authenticated";

grant update on table "public"."flashcard_topics" to "authenticated";

grant delete on table "public"."flashcard_topics" to "service_role";

grant insert on table "public"."flashcard_topics" to "service_role";

grant references on table "public"."flashcard_topics" to "service_role";

grant select on table "public"."flashcard_topics" to "service_role";

grant trigger on table "public"."flashcard_topics" to "service_role";

grant truncate on table "public"."flashcard_topics" to "service_role";

grant update on table "public"."flashcard_topics" to "service_role";


