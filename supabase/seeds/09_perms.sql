-- ==========================================
-- SEED: permissions — the closed catalog (ADR-0015 §4.1)
--
-- Mirrors the rows `20261119140000_catalog_rename.sql` inserts, so a reset ends
-- with one catalog whether the rows came from the migration or this file.
-- `PERMISSIONS` in `packages/authz/src/lib/permissions.ts` is the source of
-- truth; a mismatch fails `__tests__/integration/catalog-invariants.test.ts`.
-- ==========================================

INSERT INTO public.permissions (key, category, allowed_scopes, assignable, description) VALUES
  -- Content (own | group | organization)
  ('flashcard.read',           'content', '{own,group,organization}', true,  'Read flashcards'),
  ('flashcard.create',         'content', '{own,group,organization}', true,  'Create flashcards'),
  ('flashcard.update',         'content', '{own,group,organization}', true,  'Edit flashcards'),
  ('flashcard.delete',         'content', '{own,group,organization}', true,  'Delete flashcards'),
  ('deck.read',                'content', '{own,group,organization}', true,  'Read decks'),
  ('deck.create',              'content', '{own,group,organization}', true,  'Create decks'),
  ('deck.update',              'content', '{own,group,organization}', true,  'Edit decks'),
  ('deck.delete',              'content', '{own,group,organization}', true,  'Delete decks'),
  ('topic.read',               'content', '{own,group,organization}', true,  'Read topics'),
  ('topic.create',             'content', '{own,group,organization}', true,  'Create topics'),
  ('topic.update',             'content', '{own,group,organization}', true,  'Edit topics'),
  ('topic.delete',             'content', '{own,group,organization}', true,  'Delete topics'),
  ('question.read',            'content', '{own,group,organization}', true,  'Read questions'),
  ('question.create',          'content', '{own,group,organization}', true,  'Create questions'),
  ('question.update',          'content', '{own,group,organization}', true,  'Edit questions'),
  ('question.delete',          'content', '{own,group,organization}', true,  'Delete questions'),
  ('question_bank.read',       'content', '{own,group,organization}', true,  'Read question banks'),
  ('question_bank.create',     'content', '{own,group,organization}', true,  'Create question banks'),
  ('question_bank.update',     'content', '{own,group,organization}', true,  'Edit question banks'),
  ('question_bank.delete',     'content', '{own,group,organization}', true,  'Delete question banks'),
  ('quiz.read',                'content', '{own,group,organization}', true,  'Read quizzes'),
  ('quiz.create',              'content', '{own,group,organization}', true,  'Create quizzes'),
  ('quiz.update',              'content', '{own,group,organization}', true,  'Edit quizzes'),
  ('quiz.delete',              'content', '{own,group,organization}', true,  'Delete quizzes'),
  ('assignment.read',          'content', '{own,group,organization}', true,  'Read assignments'),
  ('assignment.create',        'content', '{own,group,organization}', true,  'Create assignments'),
  ('assignment.update',        'content', '{own,group,organization}', true,  'Edit assignments'),
  ('assignment.delete',        'content', '{own,group,organization}', true,  'Delete assignments'),
  ('assignment.publish',       'content', '{own,group,organization}', true,  'Publish assignments to a class'),
  ('assignment.grade',         'content', '{own,group,organization}', true,  'Grade assignment submissions'),
  ('stats.read',               'content', '{own,group,organization}', true,  'Read study statistics'),
  -- Classes (own | group | organization, except invite which is group+)
  ('group.read',               'group',   '{own,group,organization}', true,  'Read classes'),
  ('group.manage',             'group',   '{own,group,organization}', true,  'Create, edit and delete classes'),
  ('group.member.manage',      'group',   '{own,group,organization}', true,  'Add and remove class members'),
  ('group.invite',             'group',   '{group,organization}',     true,  'Invite existing org members to a class'),
  -- Org administration (organization only)
  ('org.settings.manage',      'org',     '{organization}',           true,  'Edit organization name, slug and general settings'),
  ('org.member.manage',        'org',     '{organization}',           true,  'Change member roles and remove members'),
  ('org.invitation.manage',    'org',     '{organization}',           true,  'Invite people to the organization'),
  ('org.role.manage',          'org',     '{organization}',           true,  'Create and edit roles and their permissions'),
  ('org.seat.manage',          'org',     '{organization}',           true,  'Manage seat pools and seat assignments'),
  ('org.billing.manage',       'org',     '{organization}',           true,  'Manage the organization plan and billing'),
  ('org.report.manage',        'org',     '{organization}',           true,  'Manage the organization question-report inbox'),
  ('org.audit.read',           'org',     '{organization}',           true,  'Read the organization audit log'),
  -- Ownership is not grantable through a custom role (D16); the Admin system
  -- role keeps it.
  ('org.admin',                'org',     '{organization}',           false, 'Ownership: delete the organization and transfer ownership')
ON CONFLICT DO NOTHING;

-- ==========================================
-- SEED: org_role_permissions
-- Maps the system roles of EVERY seeded organization to the content catalog
-- with scopes. This is the same predicate `handle_new_organization` uses, so a
-- seeded organization and a trigger-created one carry identical rows:
--   admin   → every content permission at organization scope
--   teacher → every content permission at own scope
--   member  → every content permission except the staff-only `assignment.*`
--             family, read at group scope and everything else at own scope
-- Group and org authority is granted explicitly (phase 2 templates).
-- ==========================================

INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.key, 'organization'
FROM public.org_roles r, public.permissions p
WHERE r.name = 'admin'
  AND p.category = 'content'
ON CONFLICT DO NOTHING;

INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.key, 'own'
FROM public.org_roles r, public.permissions p
WHERE r.name = 'teacher'
  AND p.category = 'content'
ON CONFLICT DO NOTHING;

INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.key,
  CASE
    WHEN p.key LIKE '%.read' THEN 'group'
    ELSE 'own'
  END
FROM public.org_roles r, public.permissions p
WHERE r.name = 'member'
  AND p.category = 'content'
  AND p.key NOT LIKE 'assignment.%'
ON CONFLICT DO NOTHING;
