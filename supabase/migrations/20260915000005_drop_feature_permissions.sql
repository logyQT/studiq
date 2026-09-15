-- ==========================================================
-- DROP: feature_permissions (dead documentation table)
-- Created in 20260703000001 as "DOCUMENTATION ONLY — NOT ENFORCED"
-- with zero read sites. Feature gating (FeatureResolver) and RBAC
-- authorization (permissions) are intentionally separate layers
-- (Phase B B4) — the feature ⟹ permission junction table is dead
-- schema and is removed cleanly, no backward-compat stub.
-- ==========================================================

DROP TABLE IF EXISTS public.feature_permissions;