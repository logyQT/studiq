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
  ('study.create'),
  ('study.participate'),
  ('test.create'),
  ('test.participate'),
  ('ai.chat'),
  ('org.manage')
ON CONFLICT DO NOTHING;

-- ==========================================
-- SEED: role_permissions
-- ==========================================

-- free: all resource perms=own, feature participate=granted
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'free', p.id,
  CASE WHEN p.name IN ('study.participate', 'test.participate') THEN 'granted' ELSE 'own' END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete',
  'study.participate', 'test.participate'
)
ON CONFLICT DO NOTHING;

-- premium: resource perms=own, features=granted
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'premium', p.id,
  CASE
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat') THEN 'granted'
    WHEN p.name IN ('study.create', 'test.create') THEN 'own'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete',
  'study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat'
)
ON CONFLICT DO NOTHING;

-- student: read=university, create/update/delete=own, features=granted
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'student', p.id,
  CASE
    WHEN p.name IN ('flashcard.read', 'topic.read', 'deck.read') THEN 'university'
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat') THEN 'granted'
    WHEN p.name IN ('study.create', 'test.create') THEN 'own'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete',
  'study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat'
)
ON CONFLICT DO NOTHING;

-- teacher: create=university, read/update/delete=own, features=granted
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'teacher', p.id,
  CASE
    WHEN p.name IN ('flashcard.create', 'topic.create', 'deck.create') THEN 'university'
    WHEN p.name IN ('study.create', 'test.create') THEN 'university'
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat', 'org.manage') THEN 'granted'
    ELSE 'own'
  END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete',
  'study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage'
)
ON CONFLICT DO NOTHING;

-- university_admin: create=own, read/update/delete=university, features=granted
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'university_admin', p.id,
  CASE
    WHEN p.name IN ('flashcard.create', 'topic.create', 'deck.create') THEN 'own'
    WHEN p.name IN ('study.create', 'test.create') THEN 'own'
    WHEN p.name IN ('study.participate', 'test.participate', 'ai.chat', 'org.manage') THEN 'granted'
    ELSE 'university'
  END
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete',
  'study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage'
)
ON CONFLICT DO NOTHING;

-- sys_admin: all any
INSERT INTO public.role_permissions (role, permission_id, scope)
SELECT 'sys_admin', p.id, 'any'
FROM public.permissions p
WHERE p.name IN (
  'flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete',
  'topic.read', 'topic.create', 'topic.update', 'topic.delete',
  'deck.read', 'deck.create', 'deck.update', 'deck.delete',
  'study.create', 'study.participate', 'test.create', 'test.participate', 'ai.chat', 'org.manage'
)
ON CONFLICT DO NOTHING;
