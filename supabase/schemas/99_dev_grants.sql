-- ==========================================
-- Development grants for PostgREST access
-- These are automatically applied by the
-- Supabase dashboard on database reset.
--
-- Mirror of supabase/seeds/99_dev_grants.sql — keep both files in sync.
-- RLS is the authorization floor for PostgREST access
-- (20261023000001_rls_all_public_tables.sql); fine-grained
-- intra-organization authorization stays in the app layer
-- (buildQueryFilter, checkPermission).
-- ==========================================

GRANT USAGE ON SCHEMA public TO authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;

-- Read-only tables: written by the admin app (service role) and seeds (postgres).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.subscription_plans,
     public.plan_features,
     public.plan_limits,
     public.feature_flags,
     public.permissions,
     public.resource_permissions,
     public.user_feature_overrides,
     public.profiles
  FROM authenticated;

REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public FROM authenticated, anon;

-- Functions: never executable by PUBLIC/anon.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

REVOKE ALL ON FUNCTION public.apply_org_plan(uuid, text) FROM authenticated;
REVOKE ALL ON FUNCTION public.rls_audit() FROM authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_flashcard_decks(uuid, uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_flashcards(uuid, uuid, uuid[], uuid[], uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_question_banks(uuid, uuid, uuid) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_questions(uuid, uuid, text, uuid, uuid[], uuid[], text) FROM authenticated;
REVOKE ALL ON FUNCTION public.get_accessible_topics(uuid, uuid, uuid) FROM authenticated;

GRANT EXECUTE ON FUNCTION public.bulk_create_flashcards(jsonb, uuid, uuid, text, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.count_new_cards(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_breakdown(uuid, uuid, uuid, uuid[], uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_due_flashcards(uuid, text, uuid, integer, uuid[], uuid[], integer, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_practice_state_breakdown(uuid, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_teacher_stats(uuid[], uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_group_ids(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_flashcards(text, integer, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_org_ids() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rls_caller_org_user_ids() TO authenticated;

-- Public pricing page (unauthenticated, SELECT only).
GRANT SELECT ON public.subscription_plans TO anon;
GRANT SELECT ON public.plan_features TO anon;
GRANT SELECT ON public.plan_limits TO anon;
