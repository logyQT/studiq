-- ==========================================================
-- Migration: 20260915000006
-- Description: track who created a group, so a teacher can only
-- edit/delete groups they created themselves — not a group an org
-- admin (or another teacher) set up for the whole class.
-- ==========================================================

ALTER TABLE public.groups
  ADD COLUMN created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Existing groups predate this column — no creator can be recovered,
-- so they stay NULL. group.service.ts treats a NULL created_by as
-- "not owned by any teacher", so only a manager/sys_admin can manage
-- them going forward.
