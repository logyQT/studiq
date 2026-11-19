-- Phase 0b of the role-authority programme (ADR-0015 §8.3, §13 batch 0).
--
-- `resource_permissions` is dead: nothing writes it, per-resource sharing is
-- owned by the `*_groups` junction tables, and the only code reference is the
-- generated type file. Its own RLS policy and grants are dropped with the
-- table; the one seed reference (`99_dev_grants.sql`'s REVOKE list) is removed
-- in the same commit, because REVOKE has no IF EXISTS.
drop table if exists public.resource_permissions;

-- Entitlement keys are not permissions (ADR-0015 §8.2 invariant 1). These six
-- names are feature keys that the old "merge features into RBAC" migration
-- copied into `permissions`, where `withAuth` served them as scopes and the
-- role editor could re-issue them. The entitlement side keeps its own rows:
-- `org.manage` stays in `feature_flags` (and `ADMIN_ONLY_FEATURES`) until
-- phase 1 deletes the catalog.
delete from public.permissions
where name in (
  'study.create',
  'study.participate',
  'test.create',
  'test.participate',
  'ai.chat',
  'org.manage'
);

-- `org_role_permissions` rows are deliberately left dangling: no foreign key
-- ties them to `permissions` yet, the rows are inert, and `withAuth` reads that
-- table to build `ctx.permissionScopes`. Sweeping them would change scope
-- resolution for existing orgs, so phase 2 does it in the migration that adds
-- the `permission_key` foreign key.
