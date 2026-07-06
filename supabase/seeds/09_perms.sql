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
-- Maps dev org roles to permissions with scopes.
-- ==========================================

-- member: read=group, create/update/delete=own
INSERT INTO public.org_role_permissions (org_role_id, permission_name, scope)
SELECT r.id, p.name,
  CASE
    WHEN p.name LIKE '%.read' THEN 'group'
    ELSE 'own'
  END
FROM public.org_roles r, public.permissions p
WHERE r.organization_id = '00000000-0000-4000-8000-000000000001'
  AND r.name = 'member'
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
WHERE r.organization_id = '00000000-0000-4000-8000-000000000001'
  AND r.name = 'teacher'
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
WHERE r.organization_id = '00000000-0000-4000-8000-000000000001'
  AND r.name = 'admin'
  AND p.name IN (
    'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
    'topic.read', 'topic.create', 'topic.update', 'topic.delete',
    'deck.read', 'deck.create', 'deck.update', 'deck.delete',
    'question.read', 'question.create', 'question.update', 'question.delete',
    'question_bank.read', 'question_bank.create', 'question_bank.update', 'question_bank.delete'
  )
ON CONFLICT DO NOTHING;
