# ~~URGENT~~ RESOLVED: N+1 Permission Check

> **Status: RESOLVED** — fixed in `refactor/phase-b-decouple` B8 (`@/lib/authz`).
> `withAuth` loads every `org_role_permissions` row for the request's role in a single
> batched query into `ctx.permissionScopes`; `buildQueryFilter`, `checkPermission` and
> `hasPermission` now resolve scopes from that in-memory map (zero DB round-trips).
> The per-permission `getScope()` query loop in the old `@/lib/rbac.ts` is deleted.

## Original report

Each API request fires **20+ separate Supabase REST queries** for permission checks — one per permission name:

```
SELECT scope FROM org_role_permissions WHERE org_role_id = ? AND permission_name = 'flashcard.read'
SELECT scope FROM org_role_permissions WHERE org_role_id = ? AND permission_name = 'flashcard.create'
SELECT scope FROM org_role_permissions WHERE org_role_id = ? AND permission_name = 'flashcard.update'
...
```

## Impact

- A single request hits Supabase **44+ times** for RBAC alone
- ~170ms per permission check × 20+ = **~1s added to every request** (before any business logic)
- This scales with the number of permissions, not with the request's actual needs

## Fix

Replace per-permission queries with a single batch:

```sql
SELECT permission_name, scope FROM org_role_permissions WHERE org_role_id = ?
```

Cache the result in a `Map<Permission, Scope>` for the request's duration. Single round-trip, one query, cached in-memory per request.

## Traced via Jaeger

Visible in Jaeger at `http://localhost:16686` — look for the `GET /api/v1/permissions/me` trace with 44+ fetch spans.
