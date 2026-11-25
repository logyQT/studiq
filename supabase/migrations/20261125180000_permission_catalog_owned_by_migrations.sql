-- ==========================================================
-- #1502: the permission catalogue is migration-owned code.
--
-- `supabase/seeds/09_perms.sql` inserted all 44 rows of the closed catalogue
-- (ADR-0015 §4.1) and then repaired every organization with
-- `seed_system_role_permissions`. The migration chain inserted only 24 of the
-- keys — the legacy six, the `assignment.*` family and the 18 added by
-- `20261119140000_catalog_rename.sql` — so `db push`, which never runs seeds,
-- left every database without the 20 base content permissions and without the
-- role grants that depend on them. A seeded reset hid the gap because the seed
-- ran after the migrations and filled it in.
--
-- This file owns the five base families: flashcards, decks, topics, questions
-- and question banks. They are inserted before any organization exists on a
-- fresh chain, and `seed_system_role_permissions` then gives every existing
-- organization the rows a seeded database already had.
--
-- `on conflict do nothing` keeps the file idempotent: a database that already
-- has the rows (through the old seed, or an earlier reset) keeps them, and the
-- backfill only repairs what is missing.
-- ==========================================================

-- ==========================================================
-- 1. The 20 base content keys. Every one is content, full scope range and
--    assignable to a custom role — the same shape the other 24 keys carry.
-- ==========================================================
insert into public.permissions (key, category, allowed_scopes, assignable, description) values
  ('flashcard.read',     'content', '{own,group,organization}', true, 'Read flashcards'),
  ('flashcard.create',   'content', '{own,group,organization}', true, 'Create flashcards'),
  ('flashcard.update',   'content', '{own,group,organization}', true, 'Edit flashcards'),
  ('flashcard.delete',   'content', '{own,group,organization}', true, 'Delete flashcards'),
  ('deck.read',          'content', '{own,group,organization}', true, 'Read decks'),
  ('deck.create',        'content', '{own,group,organization}', true, 'Create decks'),
  ('deck.update',        'content', '{own,group,organization}', true, 'Edit decks'),
  ('deck.delete',        'content', '{own,group,organization}', true, 'Delete decks'),
  ('topic.read',         'content', '{own,group,organization}', true, 'Read topics'),
  ('topic.create',       'content', '{own,group,organization}', true, 'Create topics'),
  ('topic.update',       'content', '{own,group,organization}', true, 'Edit topics'),
  ('topic.delete',       'content', '{own,group,organization}', true, 'Delete topics'),
  ('question.read',      'content', '{own,group,organization}', true, 'Read questions'),
  ('question.create',    'content', '{own,group,organization}', true, 'Create questions'),
  ('question.update',    'content', '{own,group,organization}', true, 'Edit questions'),
  ('question.delete',    'content', '{own,group,organization}', true, 'Delete questions'),
  ('question_bank.read', 'content', '{own,group,organization}', true, 'Read question banks'),
  ('question_bank.create', 'content', '{own,group,organization}', true, 'Create question banks'),
  ('question_bank.update', 'content', '{own,group,organization}', true, 'Edit question banks'),
  ('question_bank.delete', 'content', '{own,group,organization}', true, 'Delete question banks')
on conflict (key) do nothing;

-- ==========================================================
-- 2. Repair every organization. The system-role templates live in
--    `DEFAULT_ROLE_PERMISSIONS`, and `seed_system_role_permissions` inserts
--    only the rows a role is missing, so this is safe to re-run.
-- ==========================================================
select public.seed_system_role_permissions(id) from public.organizations;
