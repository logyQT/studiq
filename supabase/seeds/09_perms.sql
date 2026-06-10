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
  ('deck.delete');

-- ==========================================
-- SEED: role_permissions
-- ==========================================

-- free: all own
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'free', p.id, 'own'
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete'
);

-- premium: all own
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'premium', p.id, 'own'
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete'
);

-- student: read=university, rest=own
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'student', p.id,
  CASE WHEN p.name IN ('flashcard.read', 'topic.read', 'deck.read') THEN 'university' ELSE 'own' END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete'
);

-- teacher: all university
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'teacher', p.id, 'university'
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete'
);

-- university_admin: create=own, rest=university
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'university_admin', p.id,
  CASE WHEN p.name IN ('flashcard.create', 'topic.create', 'deck.create') THEN 'own' ELSE 'university' END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete'
);

-- sys_admin: all any
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'sys_admin', p.id, 'any'
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete'
);
