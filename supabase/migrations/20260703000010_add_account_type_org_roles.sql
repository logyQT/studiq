-- ==========================================
-- Migration: Add account_type, org_roles, org_role_permissions
-- Replaces global user_role enum with per-org composable roles.
-- Drops role_permissions and org_role_display_names.
-- Adds parent_id for sub-org support.
-- ==========================================

-- 1. Create account_type enum (new, replaces user_role concept)
CREATE TYPE account_type AS ENUM ('student', 'educator', 'manager');

-- 2. Create org_roles table
CREATE TABLE public.org_roles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  description     text,
  is_system       boolean DEFAULT false,
  UNIQUE(organization_id, name)
);

CREATE INDEX idx_org_roles_org ON public.org_roles(organization_id);

-- 3. Create org_role_permissions table
CREATE TABLE public.org_role_permissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_role_id     uuid NOT NULL REFERENCES public.org_roles(id) ON DELETE CASCADE,
  permission_name text NOT NULL,
  scope           text NOT NULL CHECK (scope IN ('own', 'group', 'organization', 'any')),
  UNIQUE(org_role_id, permission_name)
);

CREATE INDEX idx_orp_role ON public.org_role_permissions(org_role_id);

-- 4. Drop old tables before the enum they reference is gone
DROP TABLE IF EXISTS public.role_permissions;
DROP TABLE IF EXISTS public.org_role_display_names;

-- 5. Add parent_id to organizations (sub-orgs)
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.organizations(id) ON DELETE SET NULL;

-- 6. Seed default roles for every existing org
DO $$
DECLARE
  org_record RECORD;
  member_role_id uuid;
  teacher_role_id uuid;
  admin_role_id uuid;
  perm_record RECORD;
BEGIN
  FOR org_record IN SELECT id FROM public.organizations LOOP
    -- Create default roles
    INSERT INTO public.org_roles (organization_id, name, description, is_system)
    VALUES (org_record.id, 'member', 'Base learner — read org content, create own', true)
    RETURNING id INTO member_role_id;

    INSERT INTO public.org_roles (organization_id, name, description, is_system)
    VALUES (org_record.id, 'teacher', 'Educator — full CRUD over org content', true)
    RETURNING id INTO teacher_role_id;

    INSERT INTO public.org_roles (organization_id, name, description, is_system)
    VALUES (org_record.id, 'admin', 'Org manager — settings, members, roles', true)
    RETURNING id INTO admin_role_id;

    -- Seed member permissions
    FOR perm_record IN
      SELECT name FROM public.permissions
      WHERE name IN (
        'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
        'topic.read', 'topic.create', 'topic.update', 'topic.delete',
        'deck.read', 'deck.create', 'deck.update', 'deck.delete',
        'question.read', 'question.create', 'question.update', 'question.delete',
        'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete'
      )
    LOOP
      INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
      VALUES (
        member_role_id,
        perm_record.name,
        CASE
          WHEN perm_record.name LIKE '%.read' THEN 'organization'
          ELSE 'own'
        END
      )
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Seed teacher permissions
    FOR perm_record IN
      SELECT name FROM public.permissions
      WHERE name IN (
        'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
        'topic.read', 'topic.create', 'topic.update', 'topic.delete',
        'deck.read', 'deck.create', 'deck.update', 'deck.delete',
        'question.read', 'question.create', 'question.update', 'question.delete',
        'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete',
        'ai.chat', 'org.manage'
      )
    LOOP
      INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
      VALUES (
        teacher_role_id,
        perm_record.name,
        CASE
          WHEN perm_record.name IN ('ai.chat', 'org.manage') THEN 'granted'
          WHEN perm_record.name LIKE '%.delete' THEN 'own'
          WHEN perm_record.name LIKE '%.read' THEN 'group'
          ELSE 'organization'
        END
      )
      ON CONFLICT DO NOTHING;
    END LOOP;

    -- Seed admin permissions
    FOR perm_record IN
      SELECT name FROM public.permissions
      WHERE name IN (
        'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
        'topic.read', 'topic.create', 'topic.update', 'topic.delete',
        'deck.read', 'deck.create', 'deck.update', 'deck.delete',
        'question.read', 'question.create', 'question.update', 'question.delete',
        'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete',
        'ai.chat', 'org.manage'
      )
    LOOP
      INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
      VALUES (
        admin_role_id,
        perm_record.name,
        CASE
          WHEN perm_record.name IN ('ai.chat', 'org.manage') THEN 'granted'
          ELSE 'organization'
        END
      )
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- 7. Migrate org_members: replace role with org_role_id
ALTER TABLE public.org_members ADD COLUMN org_role_id uuid;

UPDATE public.org_members m
SET org_role_id = r.id
FROM public.org_roles r
WHERE r.organization_id = m.organization_id
  AND r.name = CASE m.role
    WHEN 'student' THEN 'member'
    WHEN 'teacher' THEN 'teacher'
    WHEN 'sys_admin' THEN 'admin'
    ELSE 'member'
  END;

ALTER TABLE public.org_members ALTER COLUMN org_role_id SET NOT NULL;
ALTER TABLE public.org_members ADD FOREIGN KEY (org_role_id) REFERENCES public.org_roles(id);
ALTER TABLE public.org_members DROP COLUMN role;

-- 8. Migrate invitations: replace target_role with target_org_role_id
ALTER TABLE public.invitations ADD COLUMN target_org_role_id uuid;

UPDATE public.invitations i
SET target_org_role_id = r.id
FROM public.org_roles r
WHERE r.organization_id = i.organization_id
  AND r.name = CASE i.target_role
    WHEN 'student' THEN 'member'
    WHEN 'teacher' THEN 'teacher'
    WHEN 'sys_admin' THEN 'admin'
    ELSE 'member'
  END;

ALTER TABLE public.invitations ALTER COLUMN target_org_role_id SET NOT NULL;
ALTER TABLE public.invitations ADD FOREIGN KEY (target_org_role_id) REFERENCES public.org_roles(id);
ALTER TABLE public.invitations DROP COLUMN target_role;

-- 9. Rewrite handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  passed_token     text   := NEW.raw_user_meta_data->>'invite_token';
  invite_record    record;
BEGIN
  IF passed_token IS NOT NULL THEN
    SELECT * INTO invite_record
    FROM public.invitations
    WHERE token      = passed_token
      AND is_accepted = false
      AND expires_at  > now();

    IF FOUND THEN
      INSERT INTO public.profiles (id, email, full_name)
      VALUES (
        NEW.id,
        NEW.email,
        NEW.raw_user_meta_data->>'name'
      );

      INSERT INTO public.org_members (organization_id, user_id, org_role_id)
      VALUES (invite_record.organization_id, NEW.id, invite_record.target_org_role_id)
      ON CONFLICT DO NOTHING;

      UPDATE public.invitations
        SET is_accepted = true
        WHERE id = invite_record.id;

      RETURN NEW;
    END IF;
  END IF;

  INSERT INTO public.profiles (id, email, full_name)
  VALUES (NEW.id, NEW.email, NEW.raw_user_meta_data->>'name');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 10. Drop user_role enum (all columns referencing it have been migrated/removed)
DROP TYPE IF EXISTS public.user_role;
