-- Phase 0b of the role-authority programme (ADR-0015 §8.3, §13 batch 0).
--
-- `resource_permissions` is dead: nothing writes it, and per-resource sharing is
-- owned by the `*_groups` junction tables. Three references existed: the
-- generated type file (which keeps a dead block until the generator is pinned —
-- phase 1), one seed REVOKE line (`99_dev_grants.sql`, removed in the same
-- commit because REVOKE has no IF EXISTS), and this table's own RLS policy and
-- grants, which are dropped with the table.
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

-- `org_role_permissions` rows are deliberately not swept here: `withAuth` still
-- serves them, so existing orgs keep their resolution, newly created orgs stop
-- receiving these six rows from `handle_new_organization` (this migration
-- changes the catalog that trigger copies), and phase 2 sweeps the rest with
-- the `permission_key` foreign key.
