-- ==========================================================
-- #1146 (item 3): `org_seat_pools.assigned` is a server-owned counter.
--
-- `assigned` counts the rows in `org_seat_assignments`. The seat trigger
-- `maintain_seat_counts` writes it on insert and delete, so a member can never
-- be over the pool's limit and the counter can never drift from the rows.
--
-- A manager holds `update` on the table through the RLS policy
-- ("Org managers update seat pools"). PostgREST does not tell an UPDATE through
-- the API which columns the caller may touch, so the same grant let a manager
-- PATCH `{"assigned": 0}` and free every seat in the pool. The seat count is a
-- provider-billed fact, not a form field.
--
-- Fix: revoke the table-level UPDATE from both client roles, then grant UPDATE
-- on `total` alone to authenticated. A manager still sets the paid seat count
-- (`total`) through the seats page; `assigned` is writable only by the trigger
-- and the service role. The RLS policies and the `total >= assigned` CHECK stay
-- as they are — this is a column privilege, not a policy rule.
-- ==========================================================

revoke update on public.org_seat_pools from authenticated, anon;

grant update (total) on public.org_seat_pools to authenticated;

-- ==========================================================
-- Closing guard (R26): the client roles can write `total` and nothing else, the
-- service role still writes the counter, and the capacity rule still exists.
-- ==========================================================
do $$
declare
  v_bad int;
begin
  if not has_column_privilege('authenticated', 'public.org_seat_pools', 'total', 'UPDATE') then
    raise exception 'guard: authenticated cannot update org_seat_pools.total'
      using errcode = '42501';
  end if;

  if has_column_privilege('authenticated', 'public.org_seat_pools', 'assigned', 'UPDATE') then
    raise exception 'guard: authenticated can still update org_seat_pools.assigned'
      using errcode = '42501';
  end if;

  if has_table_privilege('authenticated', 'public.org_seat_pools', 'UPDATE') then
    raise exception 'guard: authenticated keeps table-level UPDATE on org_seat_pools'
      using errcode = '42501';
  end if;

  if has_table_privilege('anon', 'public.org_seat_pools', 'UPDATE') then
    raise exception 'guard: anon keeps UPDATE on org_seat_pools'
      using errcode = '42501';
  end if;

  if not has_table_privilege('service_role', 'public.org_seat_pools', 'UPDATE') then
    raise exception 'guard: service_role lost UPDATE on org_seat_pools'
      using errcode = '42501';
  end if;

  -- The counter's floor and the trigger that maintains it are unchanged.
  select count(*) into v_bad
  from pg_constraint
  where conrelid = 'public.org_seat_pools'::regclass
    and conname = 'org_seat_pools_total_not_below_assigned'
    and contype = 'c';
  if v_bad <> 1 then
    raise exception 'guard: org_seat_pools lost its total >= assigned check'
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from pg_trigger
  where tgrelid = 'public.org_seat_assignments'::regclass
    and not tgisinternal;
  if v_bad < 1 then
    raise exception 'guard: org_seat_assignments lost its seat-count trigger'
      using errcode = '23514';
  end if;
end $$;
