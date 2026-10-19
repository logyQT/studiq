-- ==========================================
-- Soft-delete for admin-initiated user deletion.
-- deleted_at marks when deletion was requested; purge_at is when the
-- account becomes eligible for permanent deletion (deleted_at + 30 days).
-- Both null = active account. The Supabase Auth side is banned via
-- admin.updateUserById(id, { ban_duration }) at the same time, so a
-- soft-deleted user can't sign in during the grace window either.
-- ==========================================

ALTER TABLE public.profiles
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN purge_at timestamptz;

CREATE INDEX idx_profiles_purge_at ON public.profiles(purge_at) WHERE purge_at IS NOT NULL;
