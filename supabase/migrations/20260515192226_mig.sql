create type "public"."plan_type" as enum ('basic', 'pro', 'enterprise');

create type "public"."question_difficulty" as enum ('easy', 'medium', 'hard');

create type "public"."question_type" as enum ('mcq', 'true_false', 'open');

create type "public"."sub_status" as enum ('active', 'past_due', 'expired', 'canceled');

create type "public"."user_role" as enum ('free', 'premium', 'student', 'teacher', 'university_admin', 'sys_admin');


  create table "public"."flashcard_practice" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "flashcard_id" uuid,
    "was_correct" boolean not null,
    "practiced_at" timestamp with time zone default now()
      );



  create table "public"."flashcard_space_assignments" (
    "flashcard_id" uuid not null,
    "space_id" uuid not null
      );



  create table "public"."flashcard_spaces" (
    "id" uuid not null default gen_random_uuid(),
    "university_id" uuid,
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
    "created_by" uuid,
    "name" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."flashcards" (
    "id" uuid not null default gen_random_uuid(),
    "university_id" uuid,
    "created_by" uuid,
    "front" text not null,
    "back" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."invitations" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "email" text not null,
    "token" text not null default encode(extensions.gen_random_bytes(16), 'hex'::text),
    "target_role" public.user_role not null,
    "university_id" uuid,
    "inviter_id" uuid,
    "is_accepted" boolean default false,
    "expires_at" timestamp with time zone not null
      );



  create table "public"."profiles" (
    "id" uuid not null,
    "email" text not null,
    "full_name" text,
    "role" public.user_role default 'free'::public.user_role,
    "university_id" uuid,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."question_answers" (
    "id" uuid not null default gen_random_uuid(),
    "question_id" uuid,
    "content" text not null,
    "is_correct" boolean not null default false,
    "order_index" integer not null default 0
      );



  create table "public"."questions" (
    "id" uuid not null default gen_random_uuid(),
    "subject_id" uuid,
    "created_by" uuid,
    "type" public.question_type not null default 'mcq'::public.question_type,
    "content" text not null,
    "explanation" text,
    "difficulty" public.question_difficulty not null default 'medium'::public.question_difficulty,
    "created_at" timestamp with time zone default now(),
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."quiz_answers" (
    "id" uuid not null default gen_random_uuid(),
    "attempt_id" uuid,
    "question_id" uuid,
    "selected_answer_id" uuid,
    "is_correct" boolean not null default false
      );



  create table "public"."quiz_attempt_questions" (
    "attempt_id" uuid not null,
    "question_id" uuid not null,
    "order_index" integer not null default 0
      );



  create table "public"."quiz_attempts" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "score" integer not null default 0,
    "total_questions" integer not null default 0,
    "config" jsonb,
    "started_at" timestamp with time zone default now(),
    "completed_at" timestamp with time zone
      );



  create table "public"."subjects" (
    "id" uuid not null default gen_random_uuid(),
    "university_id" uuid,
    "name" text not null,
    "description" text,
    "created_by" uuid,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."universities" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null,
    "slug" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."university_subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "university_id" uuid,
    "plan_type" public.plan_type default 'basic'::public.plan_type,
    "status" public.sub_status default 'active'::public.sub_status,
    "ends_at" timestamp with time zone,
    "updated_at" timestamp with time zone default now()
      );



  create table "public"."user_subscriptions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "stripe_customer_id" text,
    "stripe_subscription_id" text,
    "plan_status" public.sub_status default 'active'::public.sub_status,
    "ends_at" timestamp with time zone
      );


alter table "public"."user_subscriptions" enable row level security;

CREATE UNIQUE INDEX flashcard_practice_pkey ON public.flashcard_practice USING btree (id);

CREATE UNIQUE INDEX flashcard_space_assignments_pkey ON public.flashcard_space_assignments USING btree (flashcard_id, space_id);

CREATE UNIQUE INDEX flashcard_spaces_pkey ON public.flashcard_spaces USING btree (id);

CREATE UNIQUE INDEX flashcard_topic_assignments_pkey ON public.flashcard_topic_assignments USING btree (flashcard_id, topic_id);

CREATE UNIQUE INDEX flashcard_topics_pkey ON public.flashcard_topics USING btree (id);

CREATE UNIQUE INDEX flashcards_pkey ON public.flashcards USING btree (id);

CREATE INDEX idx_flashcard_practice_flashcard ON public.flashcard_practice USING btree (flashcard_id);

CREATE INDEX idx_flashcard_practice_user ON public.flashcard_practice USING btree (user_id);

CREATE INDEX idx_flashcard_space_assignments_space ON public.flashcard_space_assignments USING btree (space_id);

CREATE INDEX idx_flashcard_spaces_created_by ON public.flashcard_spaces USING btree (created_by);

CREATE INDEX idx_flashcard_spaces_university ON public.flashcard_spaces USING btree (university_id);

CREATE INDEX idx_flashcard_topic_assignments_topic ON public.flashcard_topic_assignments USING btree (topic_id);

CREATE INDEX idx_flashcard_topics_created_by ON public.flashcard_topics USING btree (created_by);

CREATE INDEX idx_flashcard_topics_university ON public.flashcard_topics USING btree (university_id);

CREATE INDEX idx_flashcards_created_by ON public.flashcards USING btree (created_by);

CREATE INDEX idx_flashcards_university ON public.flashcards USING btree (university_id);

CREATE INDEX idx_question_answers_question ON public.question_answers USING btree (question_id);

CREATE INDEX idx_questions_created_by ON public.questions USING btree (created_by);

CREATE INDEX idx_questions_subject ON public.questions USING btree (subject_id);

CREATE INDEX idx_quiz_answers_attempt ON public.quiz_answers USING btree (attempt_id);

CREATE INDEX idx_quiz_attempt_questions_attempt ON public.quiz_attempt_questions USING btree (attempt_id);

CREATE INDEX idx_quiz_attempts_user ON public.quiz_attempts USING btree (user_id);

CREATE INDEX idx_subjects_university ON public.subjects USING btree (university_id);

CREATE UNIQUE INDEX invitations_pkey ON public.invitations USING btree (id);

CREATE UNIQUE INDEX invitations_token_key ON public.invitations USING btree (token);

CREATE UNIQUE INDEX profiles_email_key ON public.profiles USING btree (email);

CREATE UNIQUE INDEX profiles_pkey ON public.profiles USING btree (id);

CREATE UNIQUE INDEX question_answers_pkey ON public.question_answers USING btree (id);

CREATE UNIQUE INDEX questions_pkey ON public.questions USING btree (id);

CREATE UNIQUE INDEX quiz_answers_pkey ON public.quiz_answers USING btree (id);

CREATE UNIQUE INDEX quiz_attempt_questions_pkey ON public.quiz_attempt_questions USING btree (attempt_id, question_id);

CREATE UNIQUE INDEX quiz_attempts_pkey ON public.quiz_attempts USING btree (id);

CREATE UNIQUE INDEX subjects_pkey ON public.subjects USING btree (id);

CREATE UNIQUE INDEX universities_pkey ON public.universities USING btree (id);

CREATE UNIQUE INDEX universities_slug_key ON public.universities USING btree (slug);

CREATE UNIQUE INDEX university_subscriptions_pkey ON public.university_subscriptions USING btree (id);

CREATE UNIQUE INDEX user_subscriptions_pkey ON public.user_subscriptions USING btree (id);

CREATE UNIQUE INDEX user_subscriptions_stripe_customer_id_key ON public.user_subscriptions USING btree (stripe_customer_id);

CREATE UNIQUE INDEX user_subscriptions_stripe_subscription_id_key ON public.user_subscriptions USING btree (stripe_subscription_id);

alter table "public"."flashcard_practice" add constraint "flashcard_practice_pkey" PRIMARY KEY using index "flashcard_practice_pkey";

alter table "public"."flashcard_space_assignments" add constraint "flashcard_space_assignments_pkey" PRIMARY KEY using index "flashcard_space_assignments_pkey";

alter table "public"."flashcard_spaces" add constraint "flashcard_spaces_pkey" PRIMARY KEY using index "flashcard_spaces_pkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_pkey" PRIMARY KEY using index "flashcard_topic_assignments_pkey";

alter table "public"."flashcard_topics" add constraint "flashcard_topics_pkey" PRIMARY KEY using index "flashcard_topics_pkey";

alter table "public"."flashcards" add constraint "flashcards_pkey" PRIMARY KEY using index "flashcards_pkey";

alter table "public"."invitations" add constraint "invitations_pkey" PRIMARY KEY using index "invitations_pkey";

alter table "public"."profiles" add constraint "profiles_pkey" PRIMARY KEY using index "profiles_pkey";

alter table "public"."question_answers" add constraint "question_answers_pkey" PRIMARY KEY using index "question_answers_pkey";

alter table "public"."questions" add constraint "questions_pkey" PRIMARY KEY using index "questions_pkey";

alter table "public"."quiz_answers" add constraint "quiz_answers_pkey" PRIMARY KEY using index "quiz_answers_pkey";

alter table "public"."quiz_attempt_questions" add constraint "quiz_attempt_questions_pkey" PRIMARY KEY using index "quiz_attempt_questions_pkey";

alter table "public"."quiz_attempts" add constraint "quiz_attempts_pkey" PRIMARY KEY using index "quiz_attempts_pkey";

alter table "public"."subjects" add constraint "subjects_pkey" PRIMARY KEY using index "subjects_pkey";

alter table "public"."universities" add constraint "universities_pkey" PRIMARY KEY using index "universities_pkey";

alter table "public"."university_subscriptions" add constraint "university_subscriptions_pkey" PRIMARY KEY using index "university_subscriptions_pkey";

alter table "public"."user_subscriptions" add constraint "user_subscriptions_pkey" PRIMARY KEY using index "user_subscriptions_pkey";

alter table "public"."flashcard_practice" add constraint "flashcard_practice_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_practice" validate constraint "flashcard_practice_flashcard_id_fkey";

alter table "public"."flashcard_practice" add constraint "flashcard_practice_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_practice" validate constraint "flashcard_practice_user_id_fkey";

alter table "public"."flashcard_space_assignments" add constraint "flashcard_space_assignments_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_space_assignments" validate constraint "flashcard_space_assignments_flashcard_id_fkey";

alter table "public"."flashcard_space_assignments" add constraint "flashcard_space_assignments_space_id_fkey" FOREIGN KEY (space_id) REFERENCES public.flashcard_spaces(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_space_assignments" validate constraint "flashcard_space_assignments_space_id_fkey";

alter table "public"."flashcard_spaces" add constraint "flashcard_spaces_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_spaces" validate constraint "flashcard_spaces_created_by_fkey";

alter table "public"."flashcard_spaces" add constraint "flashcard_spaces_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE SET NULL not valid;

alter table "public"."flashcard_spaces" validate constraint "flashcard_spaces_university_id_fkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_flashcard_id_fkey" FOREIGN KEY (flashcard_id) REFERENCES public.flashcards(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topic_assignments" validate constraint "flashcard_topic_assignments_flashcard_id_fkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.flashcard_topics(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topic_assignments" validate constraint "flashcard_topic_assignments_topic_id_fkey";

alter table "public"."flashcard_topics" add constraint "flashcard_topics_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."flashcard_topics" validate constraint "flashcard_topics_created_by_fkey";

alter table "public"."flashcard_topics" add constraint "flashcard_topics_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topics" validate constraint "flashcard_topics_university_id_fkey";

alter table "public"."flashcards" add constraint "flashcards_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."flashcards" validate constraint "flashcards_created_by_fkey";

alter table "public"."flashcards" add constraint "flashcards_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE SET NULL not valid;

alter table "public"."flashcards" validate constraint "flashcards_university_id_fkey";

alter table "public"."invitations" add constraint "invitations_inviter_id_fkey" FOREIGN KEY (inviter_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."invitations" validate constraint "invitations_inviter_id_fkey";

alter table "public"."invitations" add constraint "invitations_token_key" UNIQUE using index "invitations_token_key";

alter table "public"."invitations" add constraint "invitations_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE CASCADE not valid;

alter table "public"."invitations" validate constraint "invitations_university_id_fkey";

alter table "public"."profiles" add constraint "profiles_email_key" UNIQUE using index "profiles_email_key";

alter table "public"."profiles" add constraint "profiles_id_fkey" FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE not valid;

alter table "public"."profiles" validate constraint "profiles_id_fkey";

alter table "public"."profiles" add constraint "profiles_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE SET NULL not valid;

alter table "public"."profiles" validate constraint "profiles_university_id_fkey";

alter table "public"."question_answers" add constraint "question_answers_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;

alter table "public"."question_answers" validate constraint "question_answers_question_id_fkey";

alter table "public"."questions" add constraint "questions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."questions" validate constraint "questions_created_by_fkey";

alter table "public"."questions" add constraint "questions_subject_id_fkey" FOREIGN KEY (subject_id) REFERENCES public.subjects(id) ON DELETE SET NULL not valid;

alter table "public"."questions" validate constraint "questions_subject_id_fkey";

alter table "public"."quiz_answers" add constraint "quiz_answers_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempts(id) ON DELETE CASCADE not valid;

alter table "public"."quiz_answers" validate constraint "quiz_answers_attempt_id_fkey";

alter table "public"."quiz_answers" add constraint "quiz_answers_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE SET NULL not valid;

alter table "public"."quiz_answers" validate constraint "quiz_answers_question_id_fkey";

alter table "public"."quiz_answers" add constraint "quiz_answers_selected_answer_id_fkey" FOREIGN KEY (selected_answer_id) REFERENCES public.question_answers(id) ON DELETE SET NULL not valid;

alter table "public"."quiz_answers" validate constraint "quiz_answers_selected_answer_id_fkey";

alter table "public"."quiz_attempt_questions" add constraint "quiz_attempt_questions_attempt_id_fkey" FOREIGN KEY (attempt_id) REFERENCES public.quiz_attempts(id) ON DELETE CASCADE not valid;

alter table "public"."quiz_attempt_questions" validate constraint "quiz_attempt_questions_attempt_id_fkey";

alter table "public"."quiz_attempt_questions" add constraint "quiz_attempt_questions_question_id_fkey" FOREIGN KEY (question_id) REFERENCES public.questions(id) ON DELETE CASCADE not valid;

alter table "public"."quiz_attempt_questions" validate constraint "quiz_attempt_questions_question_id_fkey";

alter table "public"."quiz_attempts" add constraint "quiz_attempts_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."quiz_attempts" validate constraint "quiz_attempts_user_id_fkey";

alter table "public"."subjects" add constraint "subjects_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE SET NULL not valid;

alter table "public"."subjects" validate constraint "subjects_created_by_fkey";

alter table "public"."subjects" add constraint "subjects_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE SET NULL not valid;

alter table "public"."subjects" validate constraint "subjects_university_id_fkey";

alter table "public"."universities" add constraint "universities_slug_key" UNIQUE using index "universities_slug_key";

alter table "public"."university_subscriptions" add constraint "university_subscriptions_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE CASCADE not valid;

alter table "public"."university_subscriptions" validate constraint "university_subscriptions_university_id_fkey";

alter table "public"."user_subscriptions" add constraint "user_subscriptions_stripe_customer_id_key" UNIQUE using index "user_subscriptions_stripe_customer_id_key";

alter table "public"."user_subscriptions" add constraint "user_subscriptions_stripe_subscription_id_key" UNIQUE using index "user_subscriptions_stripe_subscription_id_key";

alter table "public"."user_subscriptions" add constraint "user_subscriptions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."user_subscriptions" validate constraint "user_subscriptions_user_id_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.admin_change_role(p_target_user uuid, p_new_role public.user_role)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role IN ('university_admin', 'sys_admin')
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Caller is not an administrator.';
  END IF;

  UPDATE public.profiles
    SET role = p_new_role
    WHERE id = p_target_user;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  passed_token  text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record record;
BEGIN
  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record
    FROM public.invitations
    WHERE token      = passed_token
      AND is_accepted = false
      AND expires_at  > now();

    IF FOUND THEN
      INSERT INTO public.profiles (id, email, full_name, role, university_id)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'name',
        invite_record.target_role,
        invite_record.university_id
      );

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: standard free signup
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name', 'free');

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.sync_profile_role_to_auth()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  UPDATE auth.users
  SET raw_app_meta_data =
        coalesce(raw_app_meta_data, '{}'::jsonb) ||
        jsonb_build_object('role', NEW.role)
  WHERE id = NEW.id;

  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.upgrade_user_to_premium(p_user_id uuid, p_stripe_cust_id text, p_stripe_sub_id text, p_ends_at timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.user_subscriptions
    (user_id, stripe_customer_id, stripe_subscription_id, plan_status, ends_at)
  VALUES
    (p_user_id, p_stripe_cust_id, p_stripe_sub_id, 'active', p_ends_at)
  ON CONFLICT (stripe_subscription_id)
  DO UPDATE SET
    plan_status = 'active',
    ends_at     = EXCLUDED.ends_at;

  -- Only elevate free users; leave admins / teachers untouched
  UPDATE public.profiles
    SET role = 'premium'
    WHERE id = p_user_id AND role = 'free';
END;
$function$
;

grant delete on table "public"."flashcard_practice" to "anon";

grant insert on table "public"."flashcard_practice" to "anon";

grant references on table "public"."flashcard_practice" to "anon";

grant select on table "public"."flashcard_practice" to "anon";

grant trigger on table "public"."flashcard_practice" to "anon";

grant truncate on table "public"."flashcard_practice" to "anon";

grant update on table "public"."flashcard_practice" to "anon";

grant delete on table "public"."flashcard_practice" to "authenticated";

grant insert on table "public"."flashcard_practice" to "authenticated";

grant references on table "public"."flashcard_practice" to "authenticated";

grant select on table "public"."flashcard_practice" to "authenticated";

grant trigger on table "public"."flashcard_practice" to "authenticated";

grant truncate on table "public"."flashcard_practice" to "authenticated";

grant update on table "public"."flashcard_practice" to "authenticated";

grant delete on table "public"."flashcard_practice" to "service_role";

grant insert on table "public"."flashcard_practice" to "service_role";

grant references on table "public"."flashcard_practice" to "service_role";

grant select on table "public"."flashcard_practice" to "service_role";

grant trigger on table "public"."flashcard_practice" to "service_role";

grant truncate on table "public"."flashcard_practice" to "service_role";

grant update on table "public"."flashcard_practice" to "service_role";

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

grant delete on table "public"."flashcards" to "anon";

grant insert on table "public"."flashcards" to "anon";

grant references on table "public"."flashcards" to "anon";

grant select on table "public"."flashcards" to "anon";

grant trigger on table "public"."flashcards" to "anon";

grant truncate on table "public"."flashcards" to "anon";

grant update on table "public"."flashcards" to "anon";

grant delete on table "public"."flashcards" to "authenticated";

grant insert on table "public"."flashcards" to "authenticated";

grant references on table "public"."flashcards" to "authenticated";

grant select on table "public"."flashcards" to "authenticated";

grant trigger on table "public"."flashcards" to "authenticated";

grant truncate on table "public"."flashcards" to "authenticated";

grant update on table "public"."flashcards" to "authenticated";

grant delete on table "public"."flashcards" to "service_role";

grant insert on table "public"."flashcards" to "service_role";

grant references on table "public"."flashcards" to "service_role";

grant select on table "public"."flashcards" to "service_role";

grant trigger on table "public"."flashcards" to "service_role";

grant truncate on table "public"."flashcards" to "service_role";

grant update on table "public"."flashcards" to "service_role";

grant delete on table "public"."invitations" to "anon";

grant insert on table "public"."invitations" to "anon";

grant references on table "public"."invitations" to "anon";

grant select on table "public"."invitations" to "anon";

grant trigger on table "public"."invitations" to "anon";

grant truncate on table "public"."invitations" to "anon";

grant update on table "public"."invitations" to "anon";

grant delete on table "public"."invitations" to "authenticated";

grant insert on table "public"."invitations" to "authenticated";

grant references on table "public"."invitations" to "authenticated";

grant select on table "public"."invitations" to "authenticated";

grant trigger on table "public"."invitations" to "authenticated";

grant truncate on table "public"."invitations" to "authenticated";

grant update on table "public"."invitations" to "authenticated";

grant delete on table "public"."invitations" to "service_role";

grant insert on table "public"."invitations" to "service_role";

grant references on table "public"."invitations" to "service_role";

grant select on table "public"."invitations" to "service_role";

grant trigger on table "public"."invitations" to "service_role";

grant truncate on table "public"."invitations" to "service_role";

grant update on table "public"."invitations" to "service_role";

grant delete on table "public"."profiles" to "anon";

grant insert on table "public"."profiles" to "anon";

grant references on table "public"."profiles" to "anon";

grant select on table "public"."profiles" to "anon";

grant trigger on table "public"."profiles" to "anon";

grant truncate on table "public"."profiles" to "anon";

grant update on table "public"."profiles" to "anon";

grant delete on table "public"."profiles" to "authenticated";

grant insert on table "public"."profiles" to "authenticated";

grant references on table "public"."profiles" to "authenticated";

grant select on table "public"."profiles" to "authenticated";

grant trigger on table "public"."profiles" to "authenticated";

grant truncate on table "public"."profiles" to "authenticated";

grant update on table "public"."profiles" to "authenticated";

grant delete on table "public"."profiles" to "service_role";

grant insert on table "public"."profiles" to "service_role";

grant references on table "public"."profiles" to "service_role";

grant select on table "public"."profiles" to "service_role";

grant trigger on table "public"."profiles" to "service_role";

grant truncate on table "public"."profiles" to "service_role";

grant update on table "public"."profiles" to "service_role";

grant delete on table "public"."question_answers" to "anon";

grant insert on table "public"."question_answers" to "anon";

grant references on table "public"."question_answers" to "anon";

grant select on table "public"."question_answers" to "anon";

grant trigger on table "public"."question_answers" to "anon";

grant truncate on table "public"."question_answers" to "anon";

grant update on table "public"."question_answers" to "anon";

grant delete on table "public"."question_answers" to "authenticated";

grant insert on table "public"."question_answers" to "authenticated";

grant references on table "public"."question_answers" to "authenticated";

grant select on table "public"."question_answers" to "authenticated";

grant trigger on table "public"."question_answers" to "authenticated";

grant truncate on table "public"."question_answers" to "authenticated";

grant update on table "public"."question_answers" to "authenticated";

grant delete on table "public"."question_answers" to "service_role";

grant insert on table "public"."question_answers" to "service_role";

grant references on table "public"."question_answers" to "service_role";

grant select on table "public"."question_answers" to "service_role";

grant trigger on table "public"."question_answers" to "service_role";

grant truncate on table "public"."question_answers" to "service_role";

grant update on table "public"."question_answers" to "service_role";

grant delete on table "public"."questions" to "anon";

grant insert on table "public"."questions" to "anon";

grant references on table "public"."questions" to "anon";

grant select on table "public"."questions" to "anon";

grant trigger on table "public"."questions" to "anon";

grant truncate on table "public"."questions" to "anon";

grant update on table "public"."questions" to "anon";

grant delete on table "public"."questions" to "authenticated";

grant insert on table "public"."questions" to "authenticated";

grant references on table "public"."questions" to "authenticated";

grant select on table "public"."questions" to "authenticated";

grant trigger on table "public"."questions" to "authenticated";

grant truncate on table "public"."questions" to "authenticated";

grant update on table "public"."questions" to "authenticated";

grant delete on table "public"."questions" to "service_role";

grant insert on table "public"."questions" to "service_role";

grant references on table "public"."questions" to "service_role";

grant select on table "public"."questions" to "service_role";

grant trigger on table "public"."questions" to "service_role";

grant truncate on table "public"."questions" to "service_role";

grant update on table "public"."questions" to "service_role";

grant delete on table "public"."quiz_answers" to "anon";

grant insert on table "public"."quiz_answers" to "anon";

grant references on table "public"."quiz_answers" to "anon";

grant select on table "public"."quiz_answers" to "anon";

grant trigger on table "public"."quiz_answers" to "anon";

grant truncate on table "public"."quiz_answers" to "anon";

grant update on table "public"."quiz_answers" to "anon";

grant delete on table "public"."quiz_answers" to "authenticated";

grant insert on table "public"."quiz_answers" to "authenticated";

grant references on table "public"."quiz_answers" to "authenticated";

grant select on table "public"."quiz_answers" to "authenticated";

grant trigger on table "public"."quiz_answers" to "authenticated";

grant truncate on table "public"."quiz_answers" to "authenticated";

grant update on table "public"."quiz_answers" to "authenticated";

grant delete on table "public"."quiz_answers" to "service_role";

grant insert on table "public"."quiz_answers" to "service_role";

grant references on table "public"."quiz_answers" to "service_role";

grant select on table "public"."quiz_answers" to "service_role";

grant trigger on table "public"."quiz_answers" to "service_role";

grant truncate on table "public"."quiz_answers" to "service_role";

grant update on table "public"."quiz_answers" to "service_role";

grant delete on table "public"."quiz_attempt_questions" to "anon";

grant insert on table "public"."quiz_attempt_questions" to "anon";

grant references on table "public"."quiz_attempt_questions" to "anon";

grant select on table "public"."quiz_attempt_questions" to "anon";

grant trigger on table "public"."quiz_attempt_questions" to "anon";

grant truncate on table "public"."quiz_attempt_questions" to "anon";

grant update on table "public"."quiz_attempt_questions" to "anon";

grant delete on table "public"."quiz_attempt_questions" to "authenticated";

grant insert on table "public"."quiz_attempt_questions" to "authenticated";

grant references on table "public"."quiz_attempt_questions" to "authenticated";

grant select on table "public"."quiz_attempt_questions" to "authenticated";

grant trigger on table "public"."quiz_attempt_questions" to "authenticated";

grant truncate on table "public"."quiz_attempt_questions" to "authenticated";

grant update on table "public"."quiz_attempt_questions" to "authenticated";

grant delete on table "public"."quiz_attempt_questions" to "service_role";

grant insert on table "public"."quiz_attempt_questions" to "service_role";

grant references on table "public"."quiz_attempt_questions" to "service_role";

grant select on table "public"."quiz_attempt_questions" to "service_role";

grant trigger on table "public"."quiz_attempt_questions" to "service_role";

grant truncate on table "public"."quiz_attempt_questions" to "service_role";

grant update on table "public"."quiz_attempt_questions" to "service_role";

grant delete on table "public"."quiz_attempts" to "anon";

grant insert on table "public"."quiz_attempts" to "anon";

grant references on table "public"."quiz_attempts" to "anon";

grant select on table "public"."quiz_attempts" to "anon";

grant trigger on table "public"."quiz_attempts" to "anon";

grant truncate on table "public"."quiz_attempts" to "anon";

grant update on table "public"."quiz_attempts" to "anon";

grant delete on table "public"."quiz_attempts" to "authenticated";

grant insert on table "public"."quiz_attempts" to "authenticated";

grant references on table "public"."quiz_attempts" to "authenticated";

grant select on table "public"."quiz_attempts" to "authenticated";

grant trigger on table "public"."quiz_attempts" to "authenticated";

grant truncate on table "public"."quiz_attempts" to "authenticated";

grant update on table "public"."quiz_attempts" to "authenticated";

grant delete on table "public"."quiz_attempts" to "service_role";

grant insert on table "public"."quiz_attempts" to "service_role";

grant references on table "public"."quiz_attempts" to "service_role";

grant select on table "public"."quiz_attempts" to "service_role";

grant trigger on table "public"."quiz_attempts" to "service_role";

grant truncate on table "public"."quiz_attempts" to "service_role";

grant update on table "public"."quiz_attempts" to "service_role";

grant delete on table "public"."subjects" to "anon";

grant insert on table "public"."subjects" to "anon";

grant references on table "public"."subjects" to "anon";

grant select on table "public"."subjects" to "anon";

grant trigger on table "public"."subjects" to "anon";

grant truncate on table "public"."subjects" to "anon";

grant update on table "public"."subjects" to "anon";

grant delete on table "public"."subjects" to "authenticated";

grant insert on table "public"."subjects" to "authenticated";

grant references on table "public"."subjects" to "authenticated";

grant select on table "public"."subjects" to "authenticated";

grant trigger on table "public"."subjects" to "authenticated";

grant truncate on table "public"."subjects" to "authenticated";

grant update on table "public"."subjects" to "authenticated";

grant delete on table "public"."subjects" to "service_role";

grant insert on table "public"."subjects" to "service_role";

grant references on table "public"."subjects" to "service_role";

grant select on table "public"."subjects" to "service_role";

grant trigger on table "public"."subjects" to "service_role";

grant truncate on table "public"."subjects" to "service_role";

grant update on table "public"."subjects" to "service_role";

grant delete on table "public"."universities" to "anon";

grant insert on table "public"."universities" to "anon";

grant references on table "public"."universities" to "anon";

grant select on table "public"."universities" to "anon";

grant trigger on table "public"."universities" to "anon";

grant truncate on table "public"."universities" to "anon";

grant update on table "public"."universities" to "anon";

grant delete on table "public"."universities" to "authenticated";

grant insert on table "public"."universities" to "authenticated";

grant references on table "public"."universities" to "authenticated";

grant select on table "public"."universities" to "authenticated";

grant trigger on table "public"."universities" to "authenticated";

grant truncate on table "public"."universities" to "authenticated";

grant update on table "public"."universities" to "authenticated";

grant delete on table "public"."universities" to "service_role";

grant insert on table "public"."universities" to "service_role";

grant references on table "public"."universities" to "service_role";

grant select on table "public"."universities" to "service_role";

grant trigger on table "public"."universities" to "service_role";

grant truncate on table "public"."universities" to "service_role";

grant update on table "public"."universities" to "service_role";

grant delete on table "public"."university_subscriptions" to "anon";

grant insert on table "public"."university_subscriptions" to "anon";

grant references on table "public"."university_subscriptions" to "anon";

grant select on table "public"."university_subscriptions" to "anon";

grant trigger on table "public"."university_subscriptions" to "anon";

grant truncate on table "public"."university_subscriptions" to "anon";

grant update on table "public"."university_subscriptions" to "anon";

grant delete on table "public"."university_subscriptions" to "authenticated";

grant insert on table "public"."university_subscriptions" to "authenticated";

grant references on table "public"."university_subscriptions" to "authenticated";

grant select on table "public"."university_subscriptions" to "authenticated";

grant trigger on table "public"."university_subscriptions" to "authenticated";

grant truncate on table "public"."university_subscriptions" to "authenticated";

grant update on table "public"."university_subscriptions" to "authenticated";

grant delete on table "public"."university_subscriptions" to "service_role";

grant insert on table "public"."university_subscriptions" to "service_role";

grant references on table "public"."university_subscriptions" to "service_role";

grant select on table "public"."university_subscriptions" to "service_role";

grant trigger on table "public"."university_subscriptions" to "service_role";

grant truncate on table "public"."university_subscriptions" to "service_role";

grant update on table "public"."university_subscriptions" to "service_role";

grant delete on table "public"."user_subscriptions" to "anon";

grant insert on table "public"."user_subscriptions" to "anon";

grant references on table "public"."user_subscriptions" to "anon";

grant select on table "public"."user_subscriptions" to "anon";

grant trigger on table "public"."user_subscriptions" to "anon";

grant truncate on table "public"."user_subscriptions" to "anon";

grant update on table "public"."user_subscriptions" to "anon";

grant delete on table "public"."user_subscriptions" to "authenticated";

grant insert on table "public"."user_subscriptions" to "authenticated";

grant references on table "public"."user_subscriptions" to "authenticated";

grant select on table "public"."user_subscriptions" to "authenticated";

grant trigger on table "public"."user_subscriptions" to "authenticated";

grant truncate on table "public"."user_subscriptions" to "authenticated";

grant update on table "public"."user_subscriptions" to "authenticated";

grant delete on table "public"."user_subscriptions" to "service_role";

grant insert on table "public"."user_subscriptions" to "service_role";

grant references on table "public"."user_subscriptions" to "service_role";

grant select on table "public"."user_subscriptions" to "service_role";

grant trigger on table "public"."user_subscriptions" to "service_role";

grant truncate on table "public"."user_subscriptions" to "service_role";

grant update on table "public"."user_subscriptions" to "service_role";

CREATE TRIGGER on_profile_role_update AFTER INSERT OR UPDATE OF role ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_to_auth();

CREATE TRIGGER set_questions_updated_at BEFORE UPDATE ON public.questions FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


