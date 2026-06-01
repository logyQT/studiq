alter table "public"."questions" add column "university_id" uuid;

alter table "public"."questions" add constraint "questions_university_id_fkey" FOREIGN KEY (university_id) REFERENCES public.universities(id) ON DELETE SET NULL not valid;

alter table "public"."questions" validate constraint "questions_university_id_fkey";


