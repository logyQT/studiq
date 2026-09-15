-- ==========================================
-- MIGRATION: handle_new_organization trigger
-- Replaces app-layer seedDefaultOrgRoles().
-- Fires AFTER INSERT on organizations.
-- Creates roles, permissions, features, limits.
-- ==========================================

CREATE OR REPLACE FUNCTION public.handle_new_organization()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_admin_id   uuid;
  v_teacher_id uuid;
  v_member_id  uuid;
  v_rec        record;
BEGIN
  -- 1. Create default roles
  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system)
  VALUES (NEW.id, 'admin', 'Org manager — settings, members, roles', 'Admin', true)
  RETURNING id INTO v_admin_id;

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system)
  VALUES (NEW.id, 'teacher', 'Educator — CRUD over own content', 'Teacher', true)
  RETURNING id INTO v_teacher_id;

  INSERT INTO public.org_roles (organization_id, name, description, display_name, is_system)
  VALUES (NEW.id, 'member', 'Base learner — read own + group content, create own', 'Student', true)
  RETURNING id INTO v_member_id;

  -- 2. Seed permissions per role
  -- admin: organization scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_admin_id, name, 'organization' FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- teacher: own scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_teacher_id, name, 'own' FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- member: group scope for read, own for everything else
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_member_id, name,
    CASE WHEN name LIKE '%.read' THEN 'group' ELSE 'own' END
  FROM public.permissions
  ON CONFLICT DO NOTHING;

  -- 3. Seed features per role from plan template
  FOR v_rec IN
    SELECT feature_key FROM public.plan_features WHERE plan_key = NEW.plan
  LOOP
    -- admin: everything
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_admin_id, v_rec.feature_key, true)
    ON CONFLICT DO NOTHING;

    -- teacher: everything except member_manage and role_builder
    IF v_rec.feature_key NOT IN ('member.manage', 'role.builder') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_teacher_id, v_rec.feature_key, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- member: only flashcards, quiz, ai, documents
    IF v_rec.feature_key IN ('flashcards', 'quiz', 'ai.chat', 'documents') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_member_id, v_rec.feature_key, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- 4. Seed org limits from plan template
  INSERT INTO public.org_limits (organization_id, limit_key, max_value)
  SELECT NEW.id, limit_key, limit_value
  FROM public.plan_limits
  WHERE plan_key = NEW.plan
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER handle_new_organization
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_organization();
