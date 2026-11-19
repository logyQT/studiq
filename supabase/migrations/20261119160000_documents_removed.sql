-- Phase 1c of the role-authority programme (ADR-0015 §5.1, §13 batch 1).
--
-- `documents` leaves the entitlement catalog. It never had a surface, and
-- ADR §5.1 keeps a key out of the catalog until it does; phase 5 deletes the
-- surface instead of gating it. Nothing gates on the key, so no read changes.
--
-- Delete order is forced by the foreign keys added in 20261119140000:
--   * `plan_entitlements.entitlement_key` → `entitlement_catalog` has no
--     `ON DELETE CASCADE`, so the plan rows must go before the catalog row;
--   * `org_role_features.feature_key` and `user_feature_overrides.feature_key`
--     → `entitlement_flags` are `ON DELETE CASCADE`, but both are deleted
--     explicitly so the intent does not depend on a constraint's rule;
--   * no `org_role_permissions` row can carry `documents`: the phase-1b
--     `migrate_org_role_permission_names()` sweep deleted that name from every
--     role (it was never a permission).
-- A later plan/role write cannot reintroduce the key: the plan row fails the
-- catalog foreign key (23503, which the admin services map to BAD_REQUEST).

delete from public.plan_entitlements where entitlement_key = 'documents';
delete from public.org_role_features where feature_key = 'documents';
delete from public.user_feature_overrides where feature_key = 'documents';
delete from public.entitlement_catalog where key = 'documents';
delete from public.entitlement_flags where key = 'documents';
