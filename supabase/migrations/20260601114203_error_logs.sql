
  create table "public"."error_logs" (
    "id" uuid not null default gen_random_uuid(),
    "error_code" text not null,
    "message" text not null,
    "stack_trace" text,
    "url" text,
    "method" text,
    "user_id" uuid,
    "metadata" jsonb,
    "created_at" timestamp with time zone default now()
      );


alter table "public"."error_logs" enable row level security;

CREATE UNIQUE INDEX error_logs_pkey ON public.error_logs USING btree (id);

CREATE INDEX idx_error_logs_created_at ON public.error_logs USING btree (created_at DESC);

CREATE INDEX idx_error_logs_error_code ON public.error_logs USING btree (error_code);

alter table "public"."error_logs" add constraint "error_logs_pkey" PRIMARY KEY using index "error_logs_pkey";

alter table "public"."error_logs" add constraint "error_logs_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) not valid;

alter table "public"."error_logs" validate constraint "error_logs_user_id_fkey";

grant delete on table "public"."error_logs" to "anon";

grant insert on table "public"."error_logs" to "anon";

grant references on table "public"."error_logs" to "anon";

grant select on table "public"."error_logs" to "anon";

grant trigger on table "public"."error_logs" to "anon";

grant truncate on table "public"."error_logs" to "anon";

grant update on table "public"."error_logs" to "anon";

grant delete on table "public"."error_logs" to "authenticated";

grant insert on table "public"."error_logs" to "authenticated";

grant references on table "public"."error_logs" to "authenticated";

grant select on table "public"."error_logs" to "authenticated";

grant trigger on table "public"."error_logs" to "authenticated";

grant truncate on table "public"."error_logs" to "authenticated";

grant update on table "public"."error_logs" to "authenticated";

grant delete on table "public"."error_logs" to "service_role";

grant insert on table "public"."error_logs" to "service_role";

grant references on table "public"."error_logs" to "service_role";

grant select on table "public"."error_logs" to "service_role";

grant trigger on table "public"."error_logs" to "service_role";

grant truncate on table "public"."error_logs" to "service_role";

grant update on table "public"."error_logs" to "service_role";


