-- ==========================================
-- TABLE: permissions
-- Static list of permission names referenced by role_permissions.
-- ==========================================

CREATE TABLE public.permissions (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
);

-- ==========================================
-- TABLE: role_permissions
-- Maps each role to a permission with a scope.
-- scope: 'own'       → user can act only on resources they created
--        'university' → user can act on resources within their university
--        'any'       → user can act on any resource globally
-- ==========================================

CREATE TABLE public.role_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role          user_role NOT NULL,
  permission_id uuid REFERENCES public.permissions(id) ON DELETE CASCADE,
  scope         text NOT NULL CHECK (scope IN ('own', 'university', 'any')),
  UNIQUE(role, permission_id, scope)
);

-- ==========================================
-- TABLE: resource_permissions
-- FUTURE: explicit per-resource grants for sharing between users.
-- Currently empty. When sharing is implemented, this table will store
-- grants at the deck or topic level (NOT individual flashcards).
-- ==========================================

CREATE TABLE public.resource_permissions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  resource_type text NOT NULL CHECK (resource_type IN ('deck', 'topic')),
  resource_id   uuid NOT NULL,
  permission    text NOT NULL CHECK (permission IN ('read', 'update', 'delete', 'share')),
  created_at    timestamptz DEFAULT now(),
  UNIQUE(user_id, resource_type, resource_id, permission)
);

CREATE INDEX idx_rp_lookup ON public.resource_permissions(resource_type, resource_id, user_id, permission);

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
