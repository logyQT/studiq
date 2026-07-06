-- ==========================================
-- TABLE: permissions
-- Static list of permission names referenced by org_role_permissions.
-- ==========================================

CREATE TABLE public.permissions (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL
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

