drop policy "Users insert own org memberships" on "public"."org_members";

drop policy "Users read own org memberships" on "public"."org_members";

drop policy "Users update own org memberships" on "public"."org_members";

drop policy "Org members read display names" on "public"."org_role_display_names";

revoke delete on table "public"."error_logs" from "anon";

revoke insert on table "public"."error_logs" from "anon";

revoke select on table "public"."error_logs" from "anon";

revoke update on table "public"."error_logs" from "anon";

revoke delete on table "public"."error_logs" from "authenticated";

revoke insert on table "public"."error_logs" from "authenticated";

revoke select on table "public"."error_logs" from "authenticated";

revoke update on table "public"."error_logs" from "authenticated";

revoke delete on table "public"."error_logs" from "service_role";

revoke insert on table "public"."error_logs" from "service_role";

revoke select on table "public"."error_logs" from "service_role";

revoke update on table "public"."error_logs" from "service_role";

revoke delete on table "public"."flashcard_deck_assignments" from "anon";

revoke insert on table "public"."flashcard_deck_assignments" from "anon";

revoke select on table "public"."flashcard_deck_assignments" from "anon";

revoke update on table "public"."flashcard_deck_assignments" from "anon";

revoke delete on table "public"."flashcard_deck_assignments" from "authenticated";

revoke insert on table "public"."flashcard_deck_assignments" from "authenticated";

revoke select on table "public"."flashcard_deck_assignments" from "authenticated";

revoke update on table "public"."flashcard_deck_assignments" from "authenticated";

revoke delete on table "public"."flashcard_deck_assignments" from "service_role";

revoke insert on table "public"."flashcard_deck_assignments" from "service_role";

revoke select on table "public"."flashcard_deck_assignments" from "service_role";

revoke update on table "public"."flashcard_deck_assignments" from "service_role";

revoke delete on table "public"."flashcard_decks" from "anon";

revoke insert on table "public"."flashcard_decks" from "anon";

revoke select on table "public"."flashcard_decks" from "anon";

revoke update on table "public"."flashcard_decks" from "anon";

revoke delete on table "public"."flashcard_decks" from "authenticated";

revoke insert on table "public"."flashcard_decks" from "authenticated";

revoke select on table "public"."flashcard_decks" from "authenticated";

revoke update on table "public"."flashcard_decks" from "authenticated";

revoke delete on table "public"."flashcard_decks" from "service_role";

revoke insert on table "public"."flashcard_decks" from "service_role";

revoke select on table "public"."flashcard_decks" from "service_role";

revoke update on table "public"."flashcard_decks" from "service_role";

revoke delete on table "public"."flashcard_practice" from "anon";

revoke insert on table "public"."flashcard_practice" from "anon";

revoke select on table "public"."flashcard_practice" from "anon";

revoke update on table "public"."flashcard_practice" from "anon";

revoke delete on table "public"."flashcard_practice" from "authenticated";

revoke insert on table "public"."flashcard_practice" from "authenticated";

revoke select on table "public"."flashcard_practice" from "authenticated";

revoke update on table "public"."flashcard_practice" from "authenticated";

revoke delete on table "public"."flashcard_practice" from "service_role";

revoke insert on table "public"."flashcard_practice" from "service_role";

revoke select on table "public"."flashcard_practice" from "service_role";

revoke update on table "public"."flashcard_practice" from "service_role";

revoke delete on table "public"."flashcard_review_state" from "anon";

revoke insert on table "public"."flashcard_review_state" from "anon";

revoke select on table "public"."flashcard_review_state" from "anon";

revoke update on table "public"."flashcard_review_state" from "anon";

revoke delete on table "public"."flashcard_review_state" from "authenticated";

revoke insert on table "public"."flashcard_review_state" from "authenticated";

revoke select on table "public"."flashcard_review_state" from "authenticated";

revoke update on table "public"."flashcard_review_state" from "authenticated";

revoke delete on table "public"."flashcard_review_state" from "service_role";

revoke insert on table "public"."flashcard_review_state" from "service_role";

revoke select on table "public"."flashcard_review_state" from "service_role";

revoke update on table "public"."flashcard_review_state" from "service_role";

revoke delete on table "public"."flashcard_study_sessions" from "authenticated";

revoke insert on table "public"."flashcard_study_sessions" from "authenticated";

revoke select on table "public"."flashcard_study_sessions" from "authenticated";

revoke update on table "public"."flashcard_study_sessions" from "authenticated";

revoke delete on table "public"."flashcard_study_sessions" from "service_role";

revoke insert on table "public"."flashcard_study_sessions" from "service_role";

revoke select on table "public"."flashcard_study_sessions" from "service_role";

revoke update on table "public"."flashcard_study_sessions" from "service_role";

revoke delete on table "public"."flashcard_topic_assignments" from "anon";

revoke insert on table "public"."flashcard_topic_assignments" from "anon";

revoke select on table "public"."flashcard_topic_assignments" from "anon";

revoke update on table "public"."flashcard_topic_assignments" from "anon";

revoke delete on table "public"."flashcard_topic_assignments" from "authenticated";

revoke insert on table "public"."flashcard_topic_assignments" from "authenticated";

revoke select on table "public"."flashcard_topic_assignments" from "authenticated";

revoke update on table "public"."flashcard_topic_assignments" from "authenticated";

revoke delete on table "public"."flashcard_topic_assignments" from "service_role";

revoke insert on table "public"."flashcard_topic_assignments" from "service_role";

revoke select on table "public"."flashcard_topic_assignments" from "service_role";

revoke update on table "public"."flashcard_topic_assignments" from "service_role";

revoke delete on table "public"."flashcards" from "anon";

revoke insert on table "public"."flashcards" from "anon";

revoke select on table "public"."flashcards" from "anon";

revoke update on table "public"."flashcards" from "anon";

revoke delete on table "public"."flashcards" from "authenticated";

revoke insert on table "public"."flashcards" from "authenticated";

revoke select on table "public"."flashcards" from "authenticated";

revoke update on table "public"."flashcards" from "authenticated";

revoke delete on table "public"."flashcards" from "service_role";

revoke insert on table "public"."flashcards" from "service_role";

revoke select on table "public"."flashcards" from "service_role";

revoke update on table "public"."flashcards" from "service_role";

revoke delete on table "public"."invitations" from "anon";

revoke insert on table "public"."invitations" from "anon";

revoke select on table "public"."invitations" from "anon";

revoke update on table "public"."invitations" from "anon";

revoke delete on table "public"."invitations" from "authenticated";

revoke insert on table "public"."invitations" from "authenticated";

revoke select on table "public"."invitations" from "authenticated";

revoke update on table "public"."invitations" from "authenticated";

revoke delete on table "public"."invitations" from "service_role";

revoke insert on table "public"."invitations" from "service_role";

revoke select on table "public"."invitations" from "service_role";

revoke update on table "public"."invitations" from "service_role";

revoke delete on table "public"."org_members" from "authenticated";

revoke insert on table "public"."org_members" from "authenticated";

revoke select on table "public"."org_members" from "authenticated";

revoke update on table "public"."org_members" from "authenticated";

revoke delete on table "public"."org_members" from "service_role";

revoke insert on table "public"."org_members" from "service_role";

revoke select on table "public"."org_members" from "service_role";

revoke update on table "public"."org_members" from "service_role";

revoke select on table "public"."org_role_display_names" from "authenticated";

revoke delete on table "public"."org_role_display_names" from "service_role";

revoke insert on table "public"."org_role_display_names" from "service_role";

revoke select on table "public"."org_role_display_names" from "service_role";

revoke update on table "public"."org_role_display_names" from "service_role";

revoke delete on table "public"."organizations" from "anon";

revoke insert on table "public"."organizations" from "anon";

revoke select on table "public"."organizations" from "anon";

revoke update on table "public"."organizations" from "anon";

revoke delete on table "public"."organizations" from "authenticated";

revoke insert on table "public"."organizations" from "authenticated";

revoke select on table "public"."organizations" from "authenticated";

revoke update on table "public"."organizations" from "authenticated";

revoke delete on table "public"."organizations" from "service_role";

revoke insert on table "public"."organizations" from "service_role";

revoke select on table "public"."organizations" from "service_role";

revoke update on table "public"."organizations" from "service_role";

revoke delete on table "public"."permissions" from "anon";

revoke insert on table "public"."permissions" from "anon";

revoke select on table "public"."permissions" from "anon";

revoke update on table "public"."permissions" from "anon";

revoke delete on table "public"."permissions" from "authenticated";

revoke insert on table "public"."permissions" from "authenticated";

revoke select on table "public"."permissions" from "authenticated";

revoke update on table "public"."permissions" from "authenticated";

revoke delete on table "public"."permissions" from "service_role";

revoke insert on table "public"."permissions" from "service_role";

revoke select on table "public"."permissions" from "service_role";

revoke update on table "public"."permissions" from "service_role";

revoke delete on table "public"."profiles" from "anon";

revoke insert on table "public"."profiles" from "anon";

revoke select on table "public"."profiles" from "anon";

revoke update on table "public"."profiles" from "anon";

revoke delete on table "public"."profiles" from "authenticated";

revoke insert on table "public"."profiles" from "authenticated";

revoke select on table "public"."profiles" from "authenticated";

revoke update on table "public"."profiles" from "authenticated";

revoke delete on table "public"."profiles" from "service_role";

revoke insert on table "public"."profiles" from "service_role";

revoke select on table "public"."profiles" from "service_role";

revoke update on table "public"."profiles" from "service_role";

revoke delete on table "public"."question_answers" from "anon";

revoke insert on table "public"."question_answers" from "anon";

revoke select on table "public"."question_answers" from "anon";

revoke update on table "public"."question_answers" from "anon";

revoke delete on table "public"."question_answers" from "authenticated";

revoke insert on table "public"."question_answers" from "authenticated";

revoke select on table "public"."question_answers" from "authenticated";

revoke update on table "public"."question_answers" from "authenticated";

revoke delete on table "public"."question_answers" from "service_role";

revoke insert on table "public"."question_answers" from "service_role";

revoke select on table "public"."question_answers" from "service_role";

revoke update on table "public"."question_answers" from "service_role";

revoke delete on table "public"."question_bank_assignments" from "authenticated";

revoke insert on table "public"."question_bank_assignments" from "authenticated";

revoke select on table "public"."question_bank_assignments" from "authenticated";

revoke update on table "public"."question_bank_assignments" from "authenticated";

revoke delete on table "public"."question_bank_assignments" from "service_role";

revoke insert on table "public"."question_bank_assignments" from "service_role";

revoke select on table "public"."question_bank_assignments" from "service_role";

revoke update on table "public"."question_bank_assignments" from "service_role";

revoke delete on table "public"."question_banks" from "authenticated";

revoke insert on table "public"."question_banks" from "authenticated";

revoke select on table "public"."question_banks" from "authenticated";

revoke update on table "public"."question_banks" from "authenticated";

revoke delete on table "public"."question_banks" from "service_role";

revoke insert on table "public"."question_banks" from "service_role";

revoke select on table "public"."question_banks" from "service_role";

revoke update on table "public"."question_banks" from "service_role";

revoke delete on table "public"."question_topic_assignments" from "authenticated";

revoke insert on table "public"."question_topic_assignments" from "authenticated";

revoke select on table "public"."question_topic_assignments" from "authenticated";

revoke update on table "public"."question_topic_assignments" from "authenticated";

revoke delete on table "public"."question_topic_assignments" from "service_role";

revoke insert on table "public"."question_topic_assignments" from "service_role";

revoke select on table "public"."question_topic_assignments" from "service_role";

revoke update on table "public"."question_topic_assignments" from "service_role";

revoke delete on table "public"."questions" from "anon";

revoke insert on table "public"."questions" from "anon";

revoke select on table "public"."questions" from "anon";

revoke update on table "public"."questions" from "anon";

revoke delete on table "public"."questions" from "authenticated";

revoke insert on table "public"."questions" from "authenticated";

revoke select on table "public"."questions" from "authenticated";

revoke update on table "public"."questions" from "authenticated";

revoke delete on table "public"."questions" from "service_role";

revoke insert on table "public"."questions" from "service_role";

revoke select on table "public"."questions" from "service_role";

revoke update on table "public"."questions" from "service_role";

revoke delete on table "public"."quiz_answers" from "anon";

revoke insert on table "public"."quiz_answers" from "anon";

revoke select on table "public"."quiz_answers" from "anon";

revoke update on table "public"."quiz_answers" from "anon";

revoke delete on table "public"."quiz_answers" from "authenticated";

revoke insert on table "public"."quiz_answers" from "authenticated";

revoke select on table "public"."quiz_answers" from "authenticated";

revoke update on table "public"."quiz_answers" from "authenticated";

revoke delete on table "public"."quiz_answers" from "service_role";

revoke insert on table "public"."quiz_answers" from "service_role";

revoke select on table "public"."quiz_answers" from "service_role";

revoke update on table "public"."quiz_answers" from "service_role";

revoke delete on table "public"."quiz_attempt_questions" from "anon";

revoke insert on table "public"."quiz_attempt_questions" from "anon";

revoke select on table "public"."quiz_attempt_questions" from "anon";

revoke update on table "public"."quiz_attempt_questions" from "anon";

revoke delete on table "public"."quiz_attempt_questions" from "authenticated";

revoke insert on table "public"."quiz_attempt_questions" from "authenticated";

revoke select on table "public"."quiz_attempt_questions" from "authenticated";

revoke update on table "public"."quiz_attempt_questions" from "authenticated";

revoke delete on table "public"."quiz_attempt_questions" from "service_role";

revoke insert on table "public"."quiz_attempt_questions" from "service_role";

revoke select on table "public"."quiz_attempt_questions" from "service_role";

revoke update on table "public"."quiz_attempt_questions" from "service_role";

revoke delete on table "public"."quiz_attempts" from "anon";

revoke insert on table "public"."quiz_attempts" from "anon";

revoke select on table "public"."quiz_attempts" from "anon";

revoke update on table "public"."quiz_attempts" from "anon";

revoke delete on table "public"."quiz_attempts" from "authenticated";

revoke insert on table "public"."quiz_attempts" from "authenticated";

revoke select on table "public"."quiz_attempts" from "authenticated";

revoke update on table "public"."quiz_attempts" from "authenticated";

revoke delete on table "public"."quiz_attempts" from "service_role";

revoke insert on table "public"."quiz_attempts" from "service_role";

revoke select on table "public"."quiz_attempts" from "service_role";

revoke update on table "public"."quiz_attempts" from "service_role";

revoke delete on table "public"."resource_permissions" from "anon";

revoke insert on table "public"."resource_permissions" from "anon";

revoke select on table "public"."resource_permissions" from "anon";

revoke update on table "public"."resource_permissions" from "anon";

revoke delete on table "public"."resource_permissions" from "authenticated";

revoke insert on table "public"."resource_permissions" from "authenticated";

revoke select on table "public"."resource_permissions" from "authenticated";

revoke update on table "public"."resource_permissions" from "authenticated";

revoke delete on table "public"."resource_permissions" from "service_role";

revoke insert on table "public"."resource_permissions" from "service_role";

revoke select on table "public"."resource_permissions" from "service_role";

revoke update on table "public"."resource_permissions" from "service_role";

revoke delete on table "public"."role_permissions" from "anon";

revoke insert on table "public"."role_permissions" from "anon";

revoke select on table "public"."role_permissions" from "anon";

revoke update on table "public"."role_permissions" from "anon";

revoke delete on table "public"."role_permissions" from "authenticated";

revoke insert on table "public"."role_permissions" from "authenticated";

revoke select on table "public"."role_permissions" from "authenticated";

revoke update on table "public"."role_permissions" from "authenticated";

revoke delete on table "public"."role_permissions" from "service_role";

revoke insert on table "public"."role_permissions" from "service_role";

revoke select on table "public"."role_permissions" from "service_role";

revoke update on table "public"."role_permissions" from "service_role";

revoke delete on table "public"."suspended_decks" from "authenticated";

revoke insert on table "public"."suspended_decks" from "authenticated";

revoke select on table "public"."suspended_decks" from "authenticated";

revoke update on table "public"."suspended_decks" from "authenticated";

revoke delete on table "public"."suspended_decks" from "service_role";

revoke insert on table "public"."suspended_decks" from "service_role";

revoke select on table "public"."suspended_decks" from "service_role";

revoke update on table "public"."suspended_decks" from "service_role";

revoke delete on table "public"."topics" from "anon";

revoke insert on table "public"."topics" from "anon";

revoke select on table "public"."topics" from "anon";

revoke update on table "public"."topics" from "anon";

revoke delete on table "public"."topics" from "authenticated";

revoke insert on table "public"."topics" from "authenticated";

revoke select on table "public"."topics" from "authenticated";

revoke update on table "public"."topics" from "authenticated";

revoke delete on table "public"."topics" from "service_role";

revoke insert on table "public"."topics" from "service_role";

revoke select on table "public"."topics" from "service_role";

revoke update on table "public"."topics" from "service_role";

revoke insert on table "public"."user_daily_activity" from "authenticated";

revoke select on table "public"."user_daily_activity" from "authenticated";

revoke update on table "public"."user_daily_activity" from "authenticated";

revoke select on table "public"."user_daily_activity" from "service_role";

revoke delete on table "public"."user_study_settings" from "authenticated";

revoke insert on table "public"."user_study_settings" from "authenticated";

revoke select on table "public"."user_study_settings" from "authenticated";

revoke update on table "public"."user_study_settings" from "authenticated";

revoke delete on table "public"."user_study_settings" from "service_role";

revoke insert on table "public"."user_study_settings" from "service_role";

revoke select on table "public"."user_study_settings" from "service_role";

revoke update on table "public"."user_study_settings" from "service_role";

alter table "public"."flashcard_decks" drop constraint if exists "flashcard_decks_university_id_fkey";

alter table "public"."flashcards" drop constraint if exists "flashcards_university_id_fkey";

alter table "public"."invitations" drop constraint if exists "invitations_university_id_fkey";

alter table "public"."organizations" drop constraint if exists "universities_slug_key";

alter table "public"."profiles" drop constraint if exists "profiles_university_id_fkey";

alter table "public"."questions" drop constraint if exists "questions_university_id_fkey";

alter table "public"."topics" drop constraint if exists "flashcard_topics_created_by_fkey";

alter table "public"."topics" drop constraint if exists "flashcard_topics_university_id_fkey";

alter table "public"."flashcards" drop constraint if exists "flashcards_created_by_fkey";

alter table "public"."question_banks" drop constraint if exists "question_banks_created_by_fkey";

alter table "public"."questions" drop constraint if exists "questions_created_by_fkey";

alter table "public"."org_members" drop constraint if exists "org_members_organization_id_fkey";

alter table "public"."org_role_display_names" drop constraint if exists "org_role_display_names_organization_id_fkey";

alter table "public"."question_banks" drop constraint if exists "question_banks_organization_id_fkey";

drop function if exists "public"."get_due_flashcards"(p_user_id uuid, p_filter_type text, p_university_id uuid, p_limit integer, p_deck_ids uuid[], p_topic_ids uuid[]);

drop function if exists "public"."search_flashcards"(search_query text, result_limit integer);

alter table "public"."organizations" drop constraint if exists "universities_pkey";

alter table "public"."flashcard_topic_assignments" drop constraint if exists "flashcard_topic_assignments_topic_id_fkey";

alter table "public"."question_topic_assignments" drop constraint if exists "question_topic_assignments_topic_id_fkey";

alter table "public"."topics" drop constraint if exists "flashcard_topics_pkey";

drop index if exists "public"."flashcard_topics_pkey";


drop index if exists "public"."idx_flashcards_uni_time";

drop index if exists "public"."idx_practice_user_correct";

drop index if exists "public"."universities_pkey";


drop index if exists "public"."universities_slug_key";


alter table "public"."error_logs" disable row level security;

alter table "public"."flashcard_decks" add column "search_vector" tsvector generated always as ((((to_tsvector('english'::regconfig, COALESCE(name, ''::text)) || to_tsvector('public.polish'::regconfig, COALESCE(name, ''::text))) || to_tsvector('english'::regconfig, COALESCE(description, ''::text))) || to_tsvector('public.polish'::regconfig, COALESCE(description, ''::text)))) stored;

alter table "public"."org_members" disable row level security;

alter table "public"."org_role_display_names" disable row level security;

alter table "public"."question_banks" add column "search_vector" tsvector generated always as ((((to_tsvector('english'::regconfig, COALESCE(name, ''::text)) || to_tsvector('public.polish'::regconfig, COALESCE(name, ''::text))) || to_tsvector('english'::regconfig, COALESCE(description, ''::text))) || to_tsvector('public.polish'::regconfig, COALESCE(description, ''::text)))) stored;

alter table "public"."questions" drop column "difficulty";

alter table "public"."questions" add column "search_vector" tsvector generated always as ((((to_tsvector('english'::regconfig, COALESCE(content, ''::text)) || to_tsvector('public.polish'::regconfig, COALESCE(content, ''::text))) || to_tsvector('english'::regconfig, COALESCE(explanation, ''::text))) || to_tsvector('public.polish'::regconfig, COALESCE(explanation, ''::text)))) stored;

alter table "public"."topics" add column "search_vector" tsvector generated always as ((to_tsvector('english'::regconfig, COALESCE(name, ''::text)) || to_tsvector('public.polish'::regconfig, COALESCE(name, ''::text)))) stored;

drop type "public"."plan_type";

drop type "public"."question_difficulty";

drop type "public"."sub_status";

CREATE INDEX idx_flashcard_decks_search_vector ON public.flashcard_decks USING gin (search_vector);

CREATE INDEX idx_flashcards_org_time ON public.flashcards USING btree (organization_id, created_at DESC, id);

CREATE INDEX idx_question_banks_search_vector ON public.question_banks USING gin (search_vector);

CREATE INDEX idx_questions_search_vector ON public.questions USING gin (search_vector);

CREATE INDEX idx_topics_search_vector ON public.topics USING gin (search_vector);

CREATE UNIQUE INDEX organizations_pkey ON public.organizations USING btree (id);

CREATE UNIQUE INDEX organizations_slug_key ON public.organizations USING btree (slug);

CREATE UNIQUE INDEX topics_pkey ON public.topics USING btree (id);

alter table "public"."organizations" add constraint "organizations_pkey" PRIMARY KEY using index "organizations_pkey";

alter table "public"."topics" add constraint "topics_pkey" PRIMARY KEY using index "topics_pkey";

alter table "public"."flashcard_topic_assignments" add constraint "flashcard_topic_assignments_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;

alter table "public"."flashcard_topic_assignments" validate constraint "flashcard_topic_assignments_topic_id_fkey";

alter table "public"."question_topic_assignments" add constraint "question_topic_assignments_topic_id_fkey" FOREIGN KEY (topic_id) REFERENCES public.topics(id) ON DELETE CASCADE not valid;

alter table "public"."question_topic_assignments" validate constraint "question_topic_assignments_topic_id_fkey";

alter table "public"."org_members" add constraint "org_members_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."org_members" validate constraint "org_members_organization_id_fkey";

alter table "public"."org_role_display_names" add constraint "org_role_display_names_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."org_role_display_names" validate constraint "org_role_display_names_organization_id_fkey";

alter table "public"."question_banks" add constraint "question_banks_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."question_banks" validate constraint "question_banks_organization_id_fkey";

alter table "public"."flashcard_decks" add constraint "flashcard_decks_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."flashcard_decks" validate constraint "flashcard_decks_organization_id_fkey";

alter table "public"."flashcards" add constraint "flashcards_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."flashcards" validate constraint "flashcards_organization_id_fkey";

alter table "public"."invitations" add constraint "invitations_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."invitations" validate constraint "invitations_organization_id_fkey";

alter table "public"."organizations" add constraint "organizations_slug_key" UNIQUE using index "organizations_slug_key";

alter table "public"."profiles" add constraint "profiles_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."profiles" validate constraint "profiles_organization_id_fkey";

alter table "public"."questions" add constraint "questions_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE SET NULL not valid;

alter table "public"."questions" validate constraint "questions_organization_id_fkey";

alter table "public"."topics" add constraint "topics_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."topics" validate constraint "topics_created_by_fkey";

alter table "public"."topics" add constraint "topics_organization_id_fkey" FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE not valid;

alter table "public"."topics" validate constraint "topics_organization_id_fkey";

alter table "public"."flashcards" add constraint "flashcards_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."flashcards" validate constraint "flashcards_created_by_fkey";

alter table "public"."question_banks" add constraint "question_banks_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."question_banks" validate constraint "question_banks_created_by_fkey";

alter table "public"."questions" add constraint "questions_created_by_fkey" FOREIGN KEY (created_by) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."questions" validate constraint "questions_created_by_fkey";

set check_function_bodies = off;

CREATE OR REPLACE FUNCTION public.bulk_create_flashcards(p_cards jsonb, p_user_id uuid, p_organization_id uuid DEFAULT NULL::uuid, p_deck_ids uuid[] DEFAULT '{}'::uuid[], p_topic_ids uuid[] DEFAULT '{}'::uuid[])
 RETURNS SETOF public.flashcards
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ids UUID[];
BEGIN
  WITH ins AS (
    INSERT INTO flashcards (front, back, created_by, organization_id)
    SELECT c->>'front', c->>'back', p_user_id, p_organization_id
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
$function$
;

CREATE OR REPLACE FUNCTION public.get_due_flashcards(p_user_id uuid, p_filter_type text DEFAULT 'own'::text, p_organization_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 20, p_deck_ids uuid[] DEFAULT NULL::uuid[], p_topic_ids uuid[] DEFAULT NULL::uuid[], p_new_card_limit integer DEFAULT 5, p_new_only boolean DEFAULT false)
 RETURNS json
 LANGUAGE plpgsql
 STABLE
AS $function$
DECLARE
  v_result JSON;
BEGIN
  WITH matching AS (
    SELECT f.id, f.front, f.back, f.created_at
    FROM flashcards f
    WHERE
      CASE p_filter_type
        WHEN 'impossible' THEN FALSE
        WHEN 'any' THEN TRUE
        WHEN 'own' THEN f.created_by = p_user_id
        WHEN 'university' THEN f.created_by = p_user_id OR f.organization_id = p_organization_id
        ELSE FALSE
      END
      AND (p_deck_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_deck_assignments WHERE deck_id = ANY(p_deck_ids)
      ))
      AND (p_topic_ids IS NULL OR f.id IN (
        SELECT flashcard_id FROM flashcard_topic_assignments WHERE topic_id = ANY(p_topic_ids)
      ))
      AND NOT EXISTS (
        SELECT 1 FROM flashcard_deck_assignments fda
        JOIN suspended_decks sd ON sd.deck_id = fda.deck_id AND sd.user_id = p_user_id
        WHERE fda.flashcard_id = f.id
      )
  ),
  with_state AS (
    SELECT
      m.id, m.front, m.back, m.created_at,
      rs.easiness_factor, rs.interval_days, rs.repetitions,
      rs.next_review_at, rs.last_reviewed_at, rs.last_quality,
      rs.learning_state, rs.learning_step, rs.lapse_count, rs.is_leech
    FROM matching m
    LEFT JOIN flashcard_review_state rs
      ON rs.flashcard_id = m.id AND rs.user_id = p_user_id
  ),
  due_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NOT NULL
      AND next_review_at <= NOW()
      AND NOT is_leech
    ORDER BY next_review_at ASC
    LIMIT p_limit
  ),
  new_cards AS (
    SELECT * FROM with_state
    WHERE easiness_factor IS NULL
    ORDER BY created_at ASC
    LIMIT p_new_card_limit
  ),
  combined AS (
    SELECT * FROM due_cards WHERE NOT p_new_only
    UNION ALL
    SELECT * FROM new_cards WHERE p_new_only
    LIMIT p_limit
  )
  SELECT COALESCE(
    (SELECT json_agg(json_build_object(
      'id', c.id,
      'front', c.front,
      'back', c.back,
      'createdAt', c.created_at,
      'reviewState', CASE WHEN c.easiness_factor IS NOT NULL THEN
        json_build_object(
          'easinessFactor', c.easiness_factor,
          'intervalDays', c.interval_days,
          'repetitions', c.repetitions,
          'nextReviewAt', c.next_review_at,
          'lastReviewedAt', c.last_reviewed_at,
          'lastQuality', c.last_quality,
          'learningState', c.learning_state,
          'learningStep', c.learning_step,
          'lapseCount', c.lapse_count,
          'isLeech', c.is_leech
        )
      ELSE NULL END,
      'deckName', (
        SELECT fd.name FROM flashcard_deck_assignments fda
        JOIN flashcard_decks fd ON fd.id = fda.deck_id
        WHERE fda.flashcard_id = c.id LIMIT 1
      ),
      'topicNames', COALESCE(
        (SELECT array_agg(DISTINCT t.name)
         FROM flashcard_topic_assignments fta
         JOIN topics t ON t.id = fta.topic_id
         WHERE fta.flashcard_id = c.id),
        '{}'
      )
    )) FROM combined c),
    '[]'::json
  ) INTO v_result;

  RETURN v_result;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.get_teacher_stats(p_flashcard_ids uuid[], p_user_id uuid, p_deck_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_flashcard_ids uuid[];
  result jsonb;
BEGIN
  IF p_deck_id IS NOT NULL THEN
    SELECT ARRAY_AGG(DISTINCT fda.flashcard_id)
    INTO v_flashcard_ids
    FROM public.flashcard_deck_assignments fda
    WHERE fda.flashcard_id = ANY(p_flashcard_ids)
      AND fda.deck_id = p_deck_id;
  ELSE
    v_flashcard_ids := p_flashcard_ids;
  END IF;

  IF v_flashcard_ids IS NULL OR array_length(v_flashcard_ids, 1) IS NULL OR array_length(v_flashcard_ids, 1) = 0 THEN
    RETURN jsonb_build_object(
      'summary', jsonb_build_object(
        'totalDecks', 0, 'totalFlashcards', 0, 'totalPractices', 0,
        'totalStudents', 0, 'overallAccuracy', 0, 'averageEasinessFactor', 0,
        'difficultyBreakdown', jsonb_build_object('easy', 0, 'medium', 0, 'hard', 0, 'new', 0)
      ),
      'byDeck', '[]'::jsonb,
      'byTopic', '[]'::jsonb
    );
  END IF;

  WITH
    decks AS (
      SELECT id, name FROM public.flashcard_decks WHERE created_by = p_user_id
    ),
    deck_assignments AS (
      SELECT flashcard_id, deck_id
      FROM public.flashcard_deck_assignments
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    topic_assignments AS (
      SELECT flashcard_id, topic_id
      FROM public.flashcard_topic_assignments
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    topics AS (
      SELECT id, name FROM public.topics
      WHERE id IN (SELECT DISTINCT topic_id FROM topic_assignments)
    ),
    practices AS (
      SELECT flashcard_id, was_correct, user_id
      FROM public.flashcard_practice
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    review_states AS (
      SELECT flashcard_id, easiness_factor
      FROM public.flashcard_review_state
      WHERE flashcard_id = ANY(v_flashcard_ids)
    ),
    summary AS (
      SELECT
        (SELECT COUNT(*) FROM decks)::int AS total_decks,
        array_length(v_flashcard_ids, 1) AS total_flashcards,
        (SELECT COUNT(*) FROM practices)::int AS total_practices,
        (SELECT COUNT(DISTINCT user_id) FROM practices)::int AS total_students,
        CASE
          WHEN (SELECT COUNT(*) FROM practices) > 0
          THEN ROUND(
            (SELECT COUNT(*) FILTER (WHERE was_correct) FROM practices) * 100.0 /
            (SELECT COUNT(*) FROM practices)
          )::int
          ELSE 0
        END AS overall_accuracy,
        COALESCE(
          (SELECT ROUND(AVG(easiness_factor)::numeric, 2) FROM review_states),
          0
        )::numeric(5,2) AS avg_ef
    ),
    deck_fc_count AS (
      SELECT da.deck_id, COUNT(DISTINCT da.flashcard_id)::int AS flashcard_count
      FROM deck_assignments da
      GROUP BY da.deck_id
    ),
    deck_practices AS (
      SELECT
        da.deck_id,
        COUNT(*)::int AS practice_count,
        COUNT(*) FILTER (WHERE p.was_correct)::int AS correct_count
      FROM deck_assignments da
      JOIN practices p ON p.flashcard_id = da.flashcard_id
      GROUP BY da.deck_id
    ),
    deck_ef AS (
      SELECT
        da.deck_id,
        ROUND(AVG(rs.easiness_factor)::numeric, 2)::numeric(5,2) AS avg_ef
      FROM deck_assignments da
      JOIN review_states rs ON rs.flashcard_id = da.flashcard_id
      GROUP BY da.deck_id
    ),
    by_deck AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'deckId', d.id,
          'deckName', d.name,
          'flashcardCount', COALESCE(dfc.flashcard_count, 0),
          'practiceCount', COALESCE(dp.practice_count, 0),
          'correctCount', COALESCE(dp.correct_count, 0),
          'accuracy', CASE
            WHEN COALESCE(dp.practice_count, 0) > 0
            THEN ROUND(dp.correct_count * 100.0 / dp.practice_count)::int
            ELSE 0
          END,
          'avgEasinessFactor', COALESCE(de.avg_ef, 0)::numeric(5,2)
        )
        ORDER BY COALESCE(dp.practice_count, 0) DESC
      ) AS data
      FROM decks d
      JOIN deck_fc_count dfc ON dfc.deck_id = d.id
      LEFT JOIN deck_practices dp ON dp.deck_id = d.id
      LEFT JOIN deck_ef de ON de.deck_id = d.id
      WHERE dfc.flashcard_count > 0
    ),
    topic_fc_count AS (
      SELECT ta.topic_id, COUNT(DISTINCT ta.flashcard_id)::int AS flashcard_count
      FROM topic_assignments ta
      GROUP BY ta.topic_id
    ),
    topic_practices AS (
      SELECT
        ta.topic_id,
        COUNT(*)::int AS practice_count,
        COUNT(*) FILTER (WHERE p.was_correct)::int AS correct_count
      FROM topic_assignments ta
      JOIN practices p ON p.flashcard_id = ta.flashcard_id
      GROUP BY ta.topic_id
    ),
    by_topic AS (
      SELECT jsonb_agg(
        jsonb_build_object(
          'topicId', t.id,
          'topicName', t.name,
          'flashcardCount', COALESCE(tfc.flashcard_count, 0),
          'practiceCount', COALESCE(tp.practice_count, 0),
          'accuracy', CASE
            WHEN COALESCE(tp.practice_count, 0) > 0
            THEN ROUND(tp.correct_count * 100.0 / tp.practice_count)::int
            ELSE 0
          END
        )
        ORDER BY COALESCE(tp.practice_count, 0) DESC
      ) AS data
      FROM topics t
      JOIN topic_fc_count tfc ON tfc.topic_id = t.id
      LEFT JOIN topic_practices tp ON tp.topic_id = t.id
      WHERE tfc.flashcard_count > 0
    ),
    student_card_diff AS (
      SELECT
        p.flashcard_id,
        CASE
          WHEN COUNT(*) FILTER (WHERE p.was_correct) * 1.0 / COUNT(*) >= 0.8 THEN 'easy'
          WHEN COUNT(*) FILTER (WHERE p.was_correct) * 1.0 / COUNT(*) >= 0.5 THEN 'medium'
          ELSE 'hard'
        END::text AS bucket
      FROM practices p
      GROUP BY p.flashcard_id, p.user_id
    ),
    card_votes AS (
      SELECT
        flashcard_id,
        COUNT(*) FILTER (WHERE bucket = 'easy')::int AS easy_votes,
        COUNT(*) FILTER (WHERE bucket = 'medium')::int AS medium_votes,
        COUNT(*) FILTER (WHERE bucket = 'hard')::int AS hard_votes
      FROM student_card_diff
      GROUP BY flashcard_id
    ),
    card_majority AS (
      SELECT
        CASE
          WHEN hard_votes >= medium_votes AND hard_votes >= easy_votes THEN 'hard'
          WHEN medium_votes >= easy_votes THEN 'medium'
          ELSE 'easy'
        END::text AS bucket
      FROM card_votes
    ),
    difficulty_breakdown AS (
      SELECT
        COALESCE(COUNT(*) FILTER (WHERE bucket = 'easy'), 0)::int AS easy,
        COALESCE(COUNT(*) FILTER (WHERE bucket = 'medium'), 0)::int AS medium,
        COALESCE(COUNT(*) FILTER (WHERE bucket = 'hard'), 0)::int AS hard
      FROM card_majority
    ),
    new_count AS (
      SELECT COUNT(*)::int AS new
      FROM UNNEST(v_flashcard_ids) AS id
      WHERE id NOT IN (SELECT DISTINCT flashcard_id FROM practices)
    )

  SELECT jsonb_build_object(
    'summary', jsonb_build_object(
      'totalDecks', (SELECT total_decks FROM summary),
      'totalFlashcards', (SELECT total_flashcards FROM summary),
      'totalPractices', (SELECT total_practices FROM summary),
      'totalStudents', (SELECT total_students FROM summary),
      'overallAccuracy', (SELECT overall_accuracy FROM summary),
      'averageEasinessFactor', (SELECT avg_ef FROM summary),
      'difficultyBreakdown', jsonb_build_object(
        'easy', (SELECT easy FROM difficulty_breakdown),
        'medium', (SELECT medium FROM difficulty_breakdown),
        'hard', (SELECT hard FROM difficulty_breakdown),
        'new', (SELECT new FROM new_count)
      )
    ),
    'byDeck', COALESCE((SELECT data FROM by_deck), '[]'::jsonb),
    'byTopic', COALESCE((SELECT data FROM by_topic), '[]'::jsonb)
  ) INTO result;

  RETURN result;
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
      INSERT INTO public.profiles (id, email, full_name, role, organization_id)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'name',
        invite_record.target_role,
        invite_record.organization_id
      );

      INSERT INTO public.org_members (organization_id, user_id, role)
      VALUES (invite_record.organization_id, NEW.id, invite_record.target_role)
      ON CONFLICT DO NOTHING;

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

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


