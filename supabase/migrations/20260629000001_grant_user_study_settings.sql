-- Grant table-level access to authenticated and service roles for user_study_settings.
-- RLS policies handle row-level filtering; these grants allow the table to be visible
-- to the Data API / PostgREST at all.

grant delete on table "public"."user_study_settings" to "authenticated";
grant insert on table "public"."user_study_settings" to "authenticated";
grant references on table "public"."user_study_settings" to "authenticated";
grant select on table "public"."user_study_settings" to "authenticated";
grant trigger on table "public"."user_study_settings" to "authenticated";
grant truncate on table "public"."user_study_settings" to "authenticated";
grant update on table "public"."user_study_settings" to "authenticated";

grant delete on table "public"."user_study_settings" to "service_role";
grant insert on table "public"."user_study_settings" to "service_role";
grant references on table "public"."user_study_settings" to "service_role";
grant select on table "public"."user_study_settings" to "service_role";
grant trigger on table "public"."user_study_settings" to "service_role";
grant truncate on table "public"."user_study_settings" to "service_role";
grant update on table "public"."user_study_settings" to "service_role";
