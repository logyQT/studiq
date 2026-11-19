-- Phase 1b of the role-authority programme (ADR-0015 §4.1, §5.1, §8, §13 batch 1).
--
-- Behaviour-neutral catalog rename: the entitlement tables get their ADR names,
-- the limit and entitlement keys become real catalogs, and `permissions` turns
-- from a name list into the closed catalog the role editor will read in phase 2.
-- Nothing resolves differently: `FEATURES`, the four legacy management keys,
-- `org_role_features`, `user_feature_overrides` and every reader keep working.
--
-- `org_role_permissions` is rewritten to the permission catalog names now
-- because phase 2 puts a foreign key on `permission_name`; the rows this
-- migration renames are not read anywhere (`withAuth` serves them as scopes, and
-- no code reads `member.manage`, `role.builder`, `org.manage`, `ai.chat`,
-- `documents`, `study.*` or `test.*` through `permissionScopes`).
--
-- Write-path change: the two foreign keys added below turn an admin free-text
-- write of an unknown entitlement or limit key into a `23503`, which the admin
-- services already map to `BAD_REQUEST`. Every key that exists today is in its
-- catalog, so reads do not change; only a hand-crafted or stale write now fails
-- closed instead of storing a key nothing resolves.

-- ==========================================
-- 1. limit_catalog — the keys `packages/server/src/services/limit.catalog.ts`
--    declares, with the scope each one resolves against.
-- ==========================================
create table public.limit_catalog (
  key text primary key,
  scope text not null check (scope in ('user', 'org'))
);

insert into public.limit_catalog (key, scope) values
  ('max_flashcards', 'user'),
  ('max_decks', 'user'),
  ('max_questions', 'user'),
  ('max_question_banks', 'user'),
  ('max_quiz_attempts_per_day', 'user'),
  ('max_ai_tokens_per_day', 'user'),
  ('max_students', 'org'),
  ('max_groups', 'org');

alter table public.limit_catalog enable row level security;

-- Catalog data is readable by any signed-in caller, exactly like `permissions`.
create policy "Authenticated catalog read" on public.limit_catalog
  for select to authenticated
  using (true);

-- ==========================================
-- 2. entitlement_catalog — the entitlement half of the split. The eleven
--    `FEATURES` keys are the current catalog; four of them are legacy
--    management markers that phase 2 deletes once the route and RLS gates read
--    permissions (see the ADR rollout, phase 2).
-- ==========================================
create table public.entitlement_catalog (
  key text primary key,
  category text not null check (category in ('baseline', 'surface')),
  scope text not null check (scope in ('personal', 'org')),
  seat_eligible boolean not null default false,
  personal_portable boolean not null default false,
  quota_limit_key text references public.limit_catalog(key)
);

insert into public.entitlement_catalog
  (key, category, scope, seat_eligible, personal_portable, quota_limit_key)
values
  -- Paid surfaces (ADR-0015 §5.1).
  ('ai.chat', 'surface', 'personal', true, true, 'max_ai_tokens_per_day'),
  ('quiz.builder', 'surface', 'personal', true, true, null),
  ('advanced.stats', 'surface', 'personal', true, true, null),
  ('documents', 'surface', 'personal', true, true, null),
  ('branding', 'surface', 'org', false, false, null),
  -- Baseline: always on, present for pricing display only (§5.1).
  -- `seat_eligible` is true because a seat plan is a personal plan and its keys
  -- must all be seat-eligible (D15).
  ('flashcards', 'baseline', 'personal', true, false, 'max_flashcards'),
  ('quiz', 'baseline', 'personal', true, false, 'max_quiz_attempts_per_day'),
  -- Legacy management markers; removed in phase 2.
  ('org.manage', 'surface', 'org', false, false, null),
  ('group.manage', 'surface', 'org', false, false, null),
  ('member.manage', 'surface', 'org', false, false, null),
  ('role.builder', 'surface', 'org', false, false, null);

alter table public.entitlement_catalog enable row level security;

create policy "Authenticated catalog read" on public.entitlement_catalog
  for select to authenticated
  using (true);

-- The schema owns the catalog write contract: production applies migrations
-- (`db push`) and never runs the seeds, so the privileges `authenticated`
-- receives by default (`arwdDxtm`, TRUNCATE included, which bypasses RLS) have
-- to be narrowed here; the dev seed that also narrowed them on a reset has been
-- retired.
revoke insert, update, delete, truncate, references, trigger
  on public.limit_catalog, public.entitlement_catalog from authenticated;

grant select on public.limit_catalog, public.entitlement_catalog to authenticated;

-- ==========================================
-- 3. Table and column renames.
--
--    Policies and grants follow the table OID, so `plan_entitlements` keeps its
--    public pricing policy and `entitlement_flags` keeps its authenticated
--    catalog policy. The existing foreign keys (`feature_key` →
--    `feature_flags`) follow the rename too.
-- ==========================================
alter table public.feature_flags rename to entitlement_flags;
alter table public.plan_features rename to plan_entitlements;
alter table public.plan_entitlements rename column feature_key to entitlement_key;

-- The catalog is now the authority for which keys a plan may include. The old
-- flag foreign key stays: every flag row is also a catalog row in phase 1b.
alter table public.plan_entitlements
  add constraint plan_entitlements_entitlement_key_fkey
  foreign key (entitlement_key) references public.entitlement_catalog(key);

alter table public.plan_limits
  add constraint plan_limits_limit_key_fkey
  foreign key (limit_key) references public.limit_catalog(key);

-- ==========================================
-- 4. `permissions` becomes the closed catalog (ADR-0015 §4.1, §8.1).
--    The old shape was `(id uuid, name text)` with a UNIQUE index on `name`;
--    `permission_key` is now the primary key. No foreign key references `id`.
-- ==========================================
alter table public.permissions drop constraint permissions_name_key;
alter table public.permissions drop constraint permissions_pkey;
alter table public.permissions drop column id;
alter table public.permissions rename column name to key;
alter table public.permissions add constraint permissions_pkey primary key (key);

alter table public.permissions
  add column category text not null default 'content'
    check (category in ('content', 'group', 'org')),
  add column allowed_scopes text[] not null default '{own,group,organization}'
    check (allowed_scopes <@ array['own', 'group', 'organization']::text[]),
  add column assignable boolean not null default true,
  add column description text;

-- The 26 keys that already exist are all content permissions: full scope range,
-- assignable. Only the description is new data.
update public.permissions p
set description = v.description
from (values
  ('flashcard.read', 'Read flashcards'),
  ('flashcard.create', 'Create flashcards'),
  ('flashcard.update', 'Edit flashcards'),
  ('flashcard.delete', 'Delete flashcards'),
  ('topic.read', 'Read topics'),
  ('topic.create', 'Create topics'),
  ('topic.update', 'Edit topics'),
  ('topic.delete', 'Delete topics'),
  ('deck.read', 'Read decks'),
  ('deck.create', 'Create decks'),
  ('deck.update', 'Edit decks'),
  ('deck.delete', 'Delete decks'),
  ('question.read', 'Read questions'),
  ('question.create', 'Create questions'),
  ('question.update', 'Edit questions'),
  ('question.delete', 'Delete questions'),
  ('question_bank.read', 'Read question banks'),
  ('question_bank.create', 'Create question banks'),
  ('question_bank.update', 'Edit question banks'),
  ('question_bank.delete', 'Delete question banks'),
  ('assignment.create', 'Create assignments'),
  ('assignment.read', 'Read assignments'),
  ('assignment.update', 'Edit assignments'),
  ('assignment.delete', 'Delete assignments'),
  ('assignment.publish', 'Publish assignments to a class'),
  ('assignment.grade', 'Grade assignment submissions')
) as v(key, description)
where p.key = v.key;

-- The 18 new keys: quiz and stats content, the four group keys and the nine
-- `org.*` keys. `org.admin` is ownership only and is not assignable to a custom
-- role (D16); every other key is.
insert into public.permissions (key, category, allowed_scopes, assignable, description) values
  ('quiz.read', 'content', '{own,group,organization}', true, 'Read quizzes'),
  ('quiz.create', 'content', '{own,group,organization}', true, 'Create quizzes'),
  ('quiz.update', 'content', '{own,group,organization}', true, 'Edit quizzes'),
  ('quiz.delete', 'content', '{own,group,organization}', true, 'Delete quizzes'),
  ('stats.read', 'content', '{own,group,organization}', true, 'Read study statistics'),
  ('group.read', 'group', '{own,group,organization}', true, 'Read classes'),
  ('group.manage', 'group', '{own,group,organization}', true, 'Create, edit and delete classes'),
  ('group.member.manage', 'group', '{own,group,organization}', true, 'Add and remove class members'),
  ('group.invite', 'group', '{group,organization}', true, 'Invite existing org members to a class'),
  ('org.settings.manage', 'org', '{organization}', true, 'Edit organization name, slug and general settings'),
  ('org.member.manage', 'org', '{organization}', true, 'Change member roles and remove members'),
  ('org.invitation.manage', 'org', '{organization}', true, 'Invite people to the organization'),
  ('org.role.manage', 'org', '{organization}', true, 'Create and edit roles and their permissions'),
  ('org.seat.manage', 'org', '{organization}', true, 'Manage seat pools and seat assignments'),
  ('org.billing.manage', 'org', '{organization}', true, 'Manage the organization plan and billing'),
  ('org.report.manage', 'org', '{organization}', true, 'Manage the organization question-report inbox'),
  ('org.audit.read', 'org', '{organization}', true, 'Read the organization audit log'),
  ('org.admin', 'org', '{organization}', false, 'Ownership: delete the organization and transfer ownership');

-- ==========================================
-- 5. Rewrite `org_role_permissions` for existing orgs.
--
--    A `db reset` runs this migration before any organization exists, so the
--    rewrite is a no-op in every automated run; production is where it matters.
--    A real function is what the integration suite exercises — replaying the
--    statement list inline could not be called from a test.
--
--    The old role editor accepted free-string names, so a role may already hold
--    both the old and the new name; the unique key is
--    (org_role_id, permission_name), so the old row has to go first. The six
--    deleted names are the entitlement keys phase 0b removed from the catalog;
--    the final sweep normalises the rest to the closed catalog.
--
--    Phase 2b renames this column and re-creates this function
--    (`20261119210000_org_role_permission_key_fk.sql`); this file cannot be made
--    replay-safe on its own, because replaying it installs the old name and the
--    phase-2b body is the only defence against that. The org-creation trigger
--    below is re-created whole by later migrations.
-- ==========================================
create or replace function public.migrate_org_role_permission_names()
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  -- 1. Dedupe: drop the old name where the role also holds the new one.
  delete from public.org_role_permissions o
  using public.org_role_permissions n
  where o.org_role_id = n.org_role_id
    and (
      (o.permission_name = 'member.manage' and n.permission_name = 'org.member.manage')
      or (o.permission_name = 'role.builder' and n.permission_name = 'org.role.manage')
    );

  -- 2. Map the two management names the permission catalog now spells `org.*`.
  update public.org_role_permissions
  set permission_name = 'org.member.manage'
  where permission_name = 'member.manage';

  update public.org_role_permissions
  set permission_name = 'org.role.manage'
  where permission_name = 'role.builder';

  -- 3. Drop the entitlement names that were never permissions.
  delete from public.org_role_permissions
  where permission_name = 'org.manage'
     or permission_name = 'ai.chat'
     or permission_name = 'documents'
     or permission_name like 'study.%'
     or permission_name like 'test.%';

  -- 4. Normalise to the closed catalog: phase 2's foreign key cannot be added
  --    over a name the catalog does not know (free strings like `deck.publish`
  --    from the old editor).
  delete from public.org_role_permissions orp
  where orp.permission_name not in (select key from public.permissions);
END;
$$;

select public.migrate_org_role_permission_names();

revoke all on function public.migrate_org_role_permission_names()
  from public, anon, authenticated;
grant execute on function public.migrate_org_role_permission_names() to service_role;

-- ==========================================
-- 6. Functions that read the old names. Each body is the newest definition with
--    only what the rename requires changed; the org-creation permission seeding
--    is the settled `category = 'content'` predicate (member still excludes the
--    staff-only `assignment.*` family).
-- ==========================================
create or replace function public.handle_new_organization()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
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

  -- 2. Seed permissions per role — content permissions only. Group and org
  --    authority is granted explicitly (phase 2 templates); entitlement keys
  --    live in `entitlement_catalog` and are never permissions.
  -- admin: organization scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_admin_id, p.key, 'organization' FROM public.permissions p
  WHERE p.category = 'content'
  ON CONFLICT DO NOTHING;

  -- teacher: own scope for all
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_teacher_id, p.key, 'own' FROM public.permissions p
  WHERE p.category = 'content'
  ON CONFLICT DO NOTHING;

  -- member: group scope for read, own for everything else — except the
  -- assessment family, which is staff-only (DEFAULT_ROLE_PERMISSIONS has no
  -- member `assignment.*` row).
  INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
  SELECT v_member_id, p.key,
    CASE WHEN p.key LIKE '%.read' THEN 'group' ELSE 'own' END
  FROM public.permissions p
  WHERE p.category = 'content'
    AND p.key NOT LIKE 'assignment.%'
  ON CONFLICT DO NOTHING;

  -- 3. Seed features per role from plan template
  FOR v_rec IN
    SELECT entitlement_key FROM public.plan_entitlements WHERE plan_key = NEW.plan
  LOOP
    -- admin: everything
    INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
    VALUES (v_admin_id, v_rec.entitlement_key, true)
    ON CONFLICT DO NOTHING;

    -- teacher: everything except member_manage and role_builder
    IF v_rec.entitlement_key NOT IN ('member.manage', 'role.builder') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_teacher_id, v_rec.entitlement_key, true)
      ON CONFLICT DO NOTHING;
    END IF;

    -- member: only flashcards, quiz, ai, documents — plus `branding`,
    -- which is display-only (write path requires AccountType.MANAGER).
    IF v_rec.entitlement_key IN ('flashcards', 'quiz', 'ai.chat', 'documents', 'branding') THEN
      INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
      VALUES (v_member_id, v_rec.entitlement_key, true)
      ON CONFLICT DO NOTHING;
    END IF;
  END LOOP;

  -- NOTE: Org limits are no longer snapshotted (#229). They are resolved live
  -- from organizations.plan -> plan_limits.
  -- NOTE: Seat pools are NO LONGER seeded at org creation (Phase B.5).
  -- Pools are created on-demand when seats are purchased (addPool).

  RETURN NEW;
END;
$$;

create or replace function public.apply_org_plan(p_org_id uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan) THEN
    RAISE EXCEPTION 'plan % not found', p_plan USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.organizations SET plan = p_plan WHERE id = p_org_id;

  -- Revoke features the new plan does not include, from every role.
  DELETE FROM public.org_role_features f
  USING public.org_roles r
  WHERE f.org_role_id = r.id
    AND r.organization_id = p_org_id
    AND f.feature_key <> 'org.manage'
    AND f.feature_key NOT IN (
      SELECT entitlement_key FROM public.plan_entitlements WHERE plan_key = p_plan
    );

  -- Grant the plan's features to the system roles.
  INSERT INTO public.org_role_features (org_role_id, feature_key, is_enabled)
  SELECT r.id, pf.entitlement_key, true
  FROM public.org_roles r
  JOIN public.plan_entitlements pf ON pf.plan_key = p_plan
  WHERE r.organization_id = p_org_id
    AND r.is_system
    AND (
      r.name = 'admin'
      OR (r.name = 'teacher' AND pf.entitlement_key NOT IN ('member.manage', 'role.builder'))
      OR (r.name = 'member'
          AND pf.entitlement_key IN ('flashcards', 'quiz', 'ai.chat', 'documents', 'branding'))
    )
  ON CONFLICT (org_role_id, feature_key) DO NOTHING;

  -- NOTE: Limits are no longer synced (#229). They are derived live from
  -- organizations.plan -> plan_limits, so changing the plan is enough.
END;
$$;

create or replace function public.has_org_feature(
  p_actor uuid,
  p_organization_id uuid,
  p_feature text
)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  SELECT EXISTS (
    SELECT 1
    FROM public.org_members om
    JOIN public.org_roles r
      ON r.id = om.org_role_id
     AND r.organization_id = om.organization_id
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_actor
      AND om.organization_id = p_organization_id
      AND (
        (r.is_system AND r.name = 'admin')
        OR EXISTS (
          SELECT 1
          FROM public.org_role_features f
          WHERE f.org_role_id = r.id
            AND f.feature_key = p_feature
            AND f.is_enabled
        )
        OR (
          NOT EXISTS (
            SELECT 1 FROM public.org_role_features f2 WHERE f2.org_role_id = r.id
          )
          -- FeatureResolver parity for a SEATED actor, both halves:
          --
          -- 1. The seat predicate below ("seated" == an assignment in this org
          --    whose pool has a non-null `plan_key`, exactly what
          --    getSeatPlanKey returns) gates the admin-only strip: the
          --    resolver strips ADMIN_ONLY_FEATURES (`org.manage`,
          --    `member.manage`, `role.builder`) for every seated non-admin
          --    role "to prevent privilege escalation through seats". The
          --    org-plan fallback must not hand those three capabilities to a
          --    seated caller (review-1-r2 B1, issue #191).
          --
          -- 2. r4 fix (review-2-r3 B1): the plan lookup below resolves the
          --    EFFECTIVE plan — the seat plan when seated, else the org plan.
          --    FeatureResolver's seated branch calls `addPlanFeatures(seatPlanKey)`
          --    and never consults `organizations.plan`, so a `launch` org with a
          --    `pro` seat must NOT inherit `group.manage` from the org plan.
          AND (
            p_feature NOT IN ('org.manage', 'member.manage', 'role.builder')
            OR NOT EXISTS (
              SELECT 1
              FROM public.org_seat_assignments sa
              JOIN public.org_seat_pools sp ON sp.id = sa.pool_id
              WHERE sa.user_id = p_actor
                AND sa.organization_id = p_organization_id
                AND sp.plan_key IS NOT NULL
            )
          )
          AND EXISTS (
            SELECT 1
            FROM public.plan_entitlements pf
            WHERE pf.entitlement_key = p_feature
              AND pf.plan_key = COALESCE(
                (
                  -- `LIMIT 1` is defensive only: org_seat_assignments has
                  -- UNIQUE(organization_id, user_id).
                  SELECT sp.plan_key
                  FROM public.org_seat_assignments sa
                  JOIN public.org_seat_pools sp ON sp.id = sa.pool_id
                  WHERE sa.user_id = p_actor
                    AND sa.organization_id = p_organization_id
                    AND sp.plan_key IS NOT NULL
                  LIMIT 1
                ),
                o.plan
              )
          )
        )
      )
  );
$$;

-- ACLs are unchanged by CREATE OR REPLACE; the functions keep the grants the
-- 0b-era definitions carry (`apply_org_plan`, `has_org_feature` service-role
-- only; `handle_new_organization` is a trigger).
