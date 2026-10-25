-- ==========================================
-- Migration: 20261025174424
-- Description: #260 - repair custom roles whose `display_name` drifted from
-- `name` on rename.
--
-- createRole() seeds display_name = name, but updateRole() only rewrote
-- display_name when the client explicitly sent it — and no client does. So the
-- first rename of a custom role left the old label in display_name, which is
-- what member/invite role pickers render while /manage/roles renders `name`
-- (one role, two names).
--
-- updateRole() now derives display_name from name on rename. This statement
-- backfills the roles that already drifted in existing environments so the fix
-- applies without asking users to rename again. `IS DISTINCT FROM` is
-- null-safe; the statement is idempotent and a no-op on clean databases.
--
-- System roles (admin/teacher/member) are excluded: their display_name is an
-- intentional pretty label (Admin/Teacher/Student) that differs from name.
-- ==========================================
UPDATE public.org_roles
SET display_name = name
WHERE is_system = false
  AND display_name IS DISTINCT FROM name;
