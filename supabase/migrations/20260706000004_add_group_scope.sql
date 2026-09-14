-- Allow 'group' as a valid scope in org_role_permissions
ALTER TABLE public.org_role_permissions
  DROP CONSTRAINT IF EXISTS org_role_permissions_scope_check;

ALTER TABLE public.org_role_permissions
  ADD CONSTRAINT org_role_permissions_scope_check
  CHECK (scope IN ('own', 'organization', 'any', 'granted', 'group'));
