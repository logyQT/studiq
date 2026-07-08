# Seat-Based Licensing — Phase 2 PRD

## Motivation

Phase 1 (org_role_features + org_limits) gives org admins role-level feature toggles and org-wide capacity caps. Phase 2 adds **per-user tier control** via seat-based licensing.

Managers need to control which individual users get which tier of features — not just what roles can do. A school might want:

- 200 students → StudiQ Pro (full AI, advanced stats)
- 20 teachers → StudiQ Master (everything)
- 5 admins → StudiQ Campus (org management)

They pay per seat, not per org tier. Unassigned seats are unused capacity.

Seats **replace** `org_role_features` in the resolution chain: when a user has a seat, their seat's plan determines features and limits. No seat = falls back to `org_role_features` (Phase 1).

## New tables

```sql
-- Pool of available seats per plan tier within an org
create table public.org_seat_pools (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  plan_key        text not null,          -- 'pro', 'master', 'campus', etc.
  total           integer not null,       -- purchased count
  assigned        integer not null default 0, -- maintained by trigger
  unique(organization_id, plan_key)
);

-- Assignment of a specific seat to a specific user
create table public.org_seat_assignments (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pool_id         uuid not null references public.org_seat_pools(id),
  user_id         uuid not null references public.profiles(id),
  assigned_by     uuid,
  assigned_at     timestamptz default now(),
  unique(organization_id, user_id)         -- one seat per user per org
);
```

## Feature resolution (Phase 2, supersedes Phase 1)

```
ctx.activeOrgId set?
  ├─ Has a seat assignment in this org?
  │   ├─ Yes → resolve features/limits from seat's plan_key
  │   │         (via plan_features / plan_limits tables)
  │   └─ No  → resolve from org_role_features / org_limits
  └─ No org → personal plan
```

When a seat is present, `org_role_features` is **ignored** for that user — the seat's plan is the full feature set. No mixing, no layering.

Role still determines RBAC permissions (what actions a user can perform), but features (plan entitlements like AI chat, advanced stats) come from the seat.

## Triggers

### Hard block: prevent over-assignment

```sql
create function check_seat_available()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  pool_record record;
begin
  select total, assigned into pool_record
  from public.org_seat_pools
  where id = new.pool_id
  for update;  -- lock row to prevent race conditions

  if pool_record.assigned >= pool_record.total then
    raise exception 'SEAT_POOL_FULL'
      using detail = format(
        'Pool %s is full (%s/%s assigned)',
        new.pool_id, pool_record.assigned, pool_record.total
      );
  end if;

  return new;
end;
$$;

create trigger check_seat_available
  before insert on public.org_seat_assignments
  for each row execute function check_seat_available();
```

The app catches `SEAT_POOL_FULL` and surfaces it as a user-friendly error. `SELECT ... FOR UPDATE` prevents race conditions on concurrent assignments.

### Maintain assigned counter

```sql
create function maintain_seat_counts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.org_seat_pools
    set assigned = assigned + 1
    where id = new.pool_id;
  elsif tg_op = 'DELETE' then
    update public.org_seat_pools
    set assigned = assigned - 1
    where id = old.pool_id;
  end if;
  return coalesce(new, old);
end;
$$;

create trigger maintain_seat_counts
  after insert or delete on public.org_seat_assignments
  for each row execute function maintain_seat_counts();
```

## Pool seeding on org creation

The `handle_new_organization` trigger (from Phase 1) is extended to also seed default seat pools based on the org's plan:

```sql
-- For a 'campus' plan org, allocate default seats:
insert into public.org_seat_pools (organization_id, plan_key, total)
values
  (new.id, 'pro',    50),   -- 50 student-tier seats
  (new.id, 'master', 10),   -- 10 educator-tier seats
  (new.id, 'campus',  5);   -- 5 manager-tier seats
```

Default allocations per plan are defined in a new `plan_seat_allocations` table or hardcoded in the trigger. When billing is added (Phase 3), the `total` column is managed by Stripe subscription item quantities.

## Limits

A seated user's limits come **entirely from their seat's plan** (`plan_limits`). No mixing with personal plan or `org_limits`.

An unseated user still uses `org_limits` + personal plan max (Phase 1 behavior).

## Assignment flow

```
Admin picks user + "StudiQ Pro" seat
  → Check: pool.assigned < pool.total?
  │   ├─ No  → HARD BLOCK + early warning ("0 Pro seats remaining")
  │   └─ Yes → INSERT assignment
  │           → trigger increments pool.assigned
  │           → user's effective plan = 'pro'

Admin unassigns:
  → DELETE assignment
  → trigger decrements pool.assigned
  → user falls back to org_role_features (Phase 1)
```

## Early warnings (notification layer)

When `assigned >= total * 0.8`, the app fires a notification (email/in-app) to org admins:

> "You've used 45/50 Pro seats. Purchase more before they run out."

Threshold configurable per org. This is UI/notification logic, not trigger-level.

## Admin UI

### Seat pools dashboard (new section in org settings)

```
Seat Licenses
┌──────────────────────────────────────────────────────────┐
│ Plan            │ Purchased │ Assigned │ Available │ Warn │
├──────────────────┼───────────┼──────────┼───────────┤     │
│ StudiQ Pro      │        50 │       32 │       18  │ 🔔  │
│ StudiQ Master   │        10 │        5 │        5  │     │
│ StudiQ Campus   │         5 │        2 │        3  │     │
├──────────────────┼───────────┼──────────┼───────────┤     │
│ [Buy Seats]      │           │          │           │     │
└──────────────────────────────────────────────────────────┘
```

### Assignment drawer (per-user)

Click "Assign" → drawer opens:

```
┌─ Assign Seat ───────────────────────────────────────┐
│ User: Jane Doe (teacher)                             │
│                                                      │
│ Available seats:                                     │
│ ○ StudiQ Pro     (18 available — 50 max)             │
│ ● StudiQ Master  ( 5 available — 10 max)             │
│ ○ StudiQ Campus  ( 3 available —  5 max)             │
│                                                      │
│ [Assign]  [Cancel]                                   │
└──────────────────────────────────────────────────────┘
```

"Buy Seats" redirects to billing (Phase 3).

## What doesn't change from Phase 1

| Piece | Why |
|-------|-----|
| `org_role_features` | Still the fallback for unseated users |
| `org_limits` | Still the fallback for unseated users |
| `handle_new_organization` trigger | Extended to also seed default seat pools |
| `personal_plan_key` | Unchanged — used outside org context |
| RBAC permissions | Unchanged — role determines actions, seat determines features |

## What changes from Phase 1

| Area | Phase 1 | Phase 2 adds |
|------|---------|-------------|
| Resolution chain | `activeOrgId → org_role_features → personal` | `activeOrgId → seat → org_role_features → personal` |
| Org creation | Seeds roles + permissions + features + limits | Also seeds default seat pools |
| `plan.resolver.ts` | Checks `org_role_features` | Checks seat assignment first, then falls back |
| Admin UI | Feature toggles per role | Seat pools dashboard + assignment drawer |
| API | PUT features + limits | PUT/GET seat pools, POST/DELETE assignments |

## Billing (deferred to Phase 3)

In Phase 2, `org_seat_pools.total` is set by:

- Default allocation from the org's plan (hardcoded in trigger or `plan_seat_allocations` table)
- Manual admin override (for early customers / internal use)

Phase 3 will connect `total` to Stripe subscription item quantities, with proration and invoicing.

## Implementation order (within Phase 2)

1. **Migration** — `CREATE TABLE org_seat_pools` + `org_seat_assignments` + triggers
2. **Extend `handle_new_organization`** — seed default seat pools
3. **Update `plan.resolver.ts`** — check seat assignment before `org_role_features`
4. **Admin API endpoints** — CRUD for pools + assignments
5. **Admin UI** — pools dashboard + assignment drawer
6. **Tests** — seat assignment resolution, hard block, pool count integrity
