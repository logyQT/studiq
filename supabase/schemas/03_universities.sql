-- ==========================================
-- TABLE: universities
-- Depends on: _enums.sql
-- ==========================================

CREATE TABLE public.universities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL,
  slug       text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);
