
  create table "public"."permissions" (
    "id" uuid not null default gen_random_uuid(),
    "name" text not null
      );



  create table "public"."resource_permissions" (
    "id" uuid not null default gen_random_uuid(),
    "user_id" uuid,
    "resource_type" text not null,
    "resource_id" uuid not null,
    "permission" text not null,
    "created_at" timestamp with time zone default now()
      );



  create table "public"."role_permissions" (
    "id" uuid not null default gen_random_uuid(),
    "role" public.user_role not null,
    "permission_id" uuid,
    "scope" text not null
      );


CREATE INDEX idx_rp_lookup ON public.resource_permissions USING btree (resource_type, resource_id, user_id, permission);

CREATE UNIQUE INDEX permissions_name_key ON public.permissions USING btree (name);

CREATE UNIQUE INDEX permissions_pkey ON public.permissions USING btree (id);

CREATE UNIQUE INDEX resource_permissions_pkey ON public.resource_permissions USING btree (id);

CREATE UNIQUE INDEX resource_permissions_user_id_resource_type_resource_id_perm_key ON public.resource_permissions USING btree (user_id, resource_type, resource_id, permission);

CREATE UNIQUE INDEX role_permissions_pkey ON public.role_permissions USING btree (id);

CREATE UNIQUE INDEX role_permissions_role_permission_id_scope_key ON public.role_permissions USING btree (role, permission_id, scope);

alter table "public"."permissions" add constraint "permissions_pkey" PRIMARY KEY using index "permissions_pkey";

alter table "public"."resource_permissions" add constraint "resource_permissions_pkey" PRIMARY KEY using index "resource_permissions_pkey";

alter table "public"."role_permissions" add constraint "role_permissions_pkey" PRIMARY KEY using index "role_permissions_pkey";

alter table "public"."permissions" add constraint "permissions_name_key" UNIQUE using index "permissions_name_key";

alter table "public"."resource_permissions" add constraint "resource_permissions_permission_check" CHECK ((permission = ANY (ARRAY['read'::text, 'update'::text, 'delete'::text, 'share'::text]))) not valid;

alter table "public"."resource_permissions" validate constraint "resource_permissions_permission_check";

alter table "public"."resource_permissions" add constraint "resource_permissions_resource_type_check" CHECK ((resource_type = ANY (ARRAY['deck'::text, 'topic'::text]))) not valid;

alter table "public"."resource_permissions" validate constraint "resource_permissions_resource_type_check";

alter table "public"."resource_permissions" add constraint "resource_permissions_user_id_fkey" FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE not valid;

alter table "public"."resource_permissions" validate constraint "resource_permissions_user_id_fkey";

alter table "public"."resource_permissions" add constraint "resource_permissions_user_id_resource_type_resource_id_perm_key" UNIQUE using index "resource_permissions_user_id_resource_type_resource_id_perm_key";

alter table "public"."role_permissions" add constraint "role_permissions_permission_id_fkey" FOREIGN KEY (permission_id) REFERENCES public.permissions(id) ON DELETE CASCADE not valid;

alter table "public"."role_permissions" validate constraint "role_permissions_permission_id_fkey";

alter table "public"."role_permissions" add constraint "role_permissions_role_permission_id_scope_key" UNIQUE using index "role_permissions_role_permission_id_scope_key";

alter table "public"."role_permissions" add constraint "role_permissions_scope_check" CHECK ((scope = ANY (ARRAY['own'::text, 'university'::text, 'any'::text]))) not valid;

alter table "public"."role_permissions" validate constraint "role_permissions_scope_check";

grant delete on table "public"."permissions" to "anon";

grant insert on table "public"."permissions" to "anon";

grant references on table "public"."permissions" to "anon";

grant select on table "public"."permissions" to "anon";

grant trigger on table "public"."permissions" to "anon";

grant truncate on table "public"."permissions" to "anon";

grant update on table "public"."permissions" to "anon";

grant delete on table "public"."permissions" to "authenticated";

grant insert on table "public"."permissions" to "authenticated";

grant references on table "public"."permissions" to "authenticated";

grant select on table "public"."permissions" to "authenticated";

grant trigger on table "public"."permissions" to "authenticated";

grant truncate on table "public"."permissions" to "authenticated";

grant update on table "public"."permissions" to "authenticated";

grant delete on table "public"."permissions" to "service_role";

grant insert on table "public"."permissions" to "service_role";

grant references on table "public"."permissions" to "service_role";

grant select on table "public"."permissions" to "service_role";

grant trigger on table "public"."permissions" to "service_role";

grant truncate on table "public"."permissions" to "service_role";

grant update on table "public"."permissions" to "service_role";

grant delete on table "public"."resource_permissions" to "anon";

grant insert on table "public"."resource_permissions" to "anon";

grant references on table "public"."resource_permissions" to "anon";

grant select on table "public"."resource_permissions" to "anon";

grant trigger on table "public"."resource_permissions" to "anon";

grant truncate on table "public"."resource_permissions" to "anon";

grant update on table "public"."resource_permissions" to "anon";

grant delete on table "public"."resource_permissions" to "authenticated";

grant insert on table "public"."resource_permissions" to "authenticated";

grant references on table "public"."resource_permissions" to "authenticated";

grant select on table "public"."resource_permissions" to "authenticated";

grant trigger on table "public"."resource_permissions" to "authenticated";

grant truncate on table "public"."resource_permissions" to "authenticated";

grant update on table "public"."resource_permissions" to "authenticated";

grant delete on table "public"."resource_permissions" to "service_role";

grant insert on table "public"."resource_permissions" to "service_role";

grant references on table "public"."resource_permissions" to "service_role";

grant select on table "public"."resource_permissions" to "service_role";

grant trigger on table "public"."resource_permissions" to "service_role";

grant truncate on table "public"."resource_permissions" to "service_role";

grant update on table "public"."resource_permissions" to "service_role";

grant delete on table "public"."role_permissions" to "anon";

grant insert on table "public"."role_permissions" to "anon";

grant references on table "public"."role_permissions" to "anon";

grant select on table "public"."role_permissions" to "anon";

grant trigger on table "public"."role_permissions" to "anon";

grant truncate on table "public"."role_permissions" to "anon";

grant update on table "public"."role_permissions" to "anon";

grant delete on table "public"."role_permissions" to "authenticated";

grant insert on table "public"."role_permissions" to "authenticated";

grant references on table "public"."role_permissions" to "authenticated";

grant select on table "public"."role_permissions" to "authenticated";

grant trigger on table "public"."role_permissions" to "authenticated";

grant truncate on table "public"."role_permissions" to "authenticated";

grant update on table "public"."role_permissions" to "authenticated";

grant delete on table "public"."role_permissions" to "service_role";

grant insert on table "public"."role_permissions" to "service_role";

grant references on table "public"."role_permissions" to "service_role";

grant select on table "public"."role_permissions" to "service_role";

grant trigger on table "public"."role_permissions" to "service_role";

grant truncate on table "public"."role_permissions" to "service_role";

grant update on table "public"."role_permissions" to "service_role";


