-- ==========================================
-- SEED: permissions
-- ==========================================

INSERT INTO public.permissions (name) VALUES
  ('flashcard.read'),
  ('flashcard.create'),
  ('flashcard.update'),
  ('flashcard.delete'),
  ('topic.read'),
  ('topic.create'),
  ('topic.update'),
  ('topic.delete'),
  ('deck.read'),
  ('deck.create'),
  ('deck.update'),
  ('deck.delete'),
  ('question.read'),
  ('question.create'),
  ('question.update'),
  ('question.delete'),
  ('question_bank.read'),
  ('question_bank.create'),
  ('question_bank.update'),
  ('question_bank.delete')
ON CONFLICT DO NOTHING;

-- ==========================================
-- SEED: org_role_permissions
-- Maps the system roles of EVERY seeded organization to permissions with
-- scopes. (Organizations are inserted by 01_seed.sql before this file adds the
-- content permissions, so the handle_new_organization trigger only copied the
-- few legacy permissions that existed then.)
-- ==========================================

-- member: read=group, create/update/delete=own
INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.name,
  CASE
    WHEN p.name LIKE '%.read' THEN 'group'
    ELSE 'own'
  END
FROM public.org_roles r, public.permissions p
WHERE r.name = 'member'
  AND p.name IN (
    'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
    'topic.read', 'topic.create', 'topic.update', 'topic.delete',
    'deck.read', 'deck.create', 'deck.update', 'deck.delete',
    'question.read', 'question.create', 'question.update', 'question.delete',
    'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete'
  )
ON CONFLICT DO NOTHING;

-- teacher: all=own
INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.name, 'own'
FROM public.org_roles r, public.permissions p
WHERE r.name = 'teacher'
  AND p.name IN (
    'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
    'topic.read', 'topic.create', 'topic.update', 'topic.delete',
    'deck.read', 'deck.create', 'deck.update', 'deck.delete',
    'question.read', 'question.create', 'question.update', 'question.delete',
    'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete'
  )
ON CONFLICT DO NOTHING;

-- admin: all=organization
INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.name, 'organization'
FROM public.org_roles r, public.permissions p
WHERE r.name = 'admin'
  AND p.name IN (
    'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
    'topic.read', 'topic.create', 'topic.update', 'topic.delete',
    'deck.read', 'deck.create', 'deck.update', 'deck.delete',
    'question.read', 'question.create', 'question.update', 'question.delete',
    'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete'
  )
ON CONFLICT DO NOTHING;
