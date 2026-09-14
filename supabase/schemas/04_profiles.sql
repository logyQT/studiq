-- ==========================================
-- TABLE: profiles
-- Depends on: 00_enums.sql, 03_organizations.sql
-- Extends auth.users (1-to-1 via id FK)
-- ==========================================

CREATE TABLE public.profiles (
  id              uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email           text UNIQUE NOT NULL,
  full_name       text,
  created_at      timestamptz DEFAULT now()
);
