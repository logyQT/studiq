-- ==========================================================
-- #1495 (B3) follow-up: an anonymous client reads the listed catalogue only.
--
-- `20261024124756` gave `anon` and `authenticated` one `using (true)` policy per
-- pricing table. That was correct while every plan was public; B3 added
-- `visibility = 'unlisted'`, so the same policy let the publishable key read a
-- sales-led contract plan, its price, its entitlements and its limits.
--
-- The policy is now split by role:
--
--   * `anon` reads `subscription_plans` only where `visibility = 'public'` and
--     `is_active`, and `plan_entitlements` / `plan_limits` only for such a plan
--     (one `exists` against the parent row). The two catalogue tables carry no
--     visibility of their own, so the parent predicate is the only answer.
--   * `authenticated` keeps `using (true)` on all three. `/me/plan` and
--     `/me/personal-plan` read the caller's own plan rows with the user client
--     (`subscription-plan.service.ts`), and an organization on an unlisted plan
--     must keep resolving for its managers.
--
-- The table grants stay: `anon` keeps SELECT on the three tables, because the
-- public pricing page still reads them (`20261024124757`). Only the row set
-- narrows.
--
-- Residual, stated here and in `docs/deployment.md`: a signed-in user can still
-- read the whole plan catalogue table directly, including an unlisted plan. That
-- is the pre-existing property D34 records for `authenticated` on the pricing
-- tables; this file closes the anonymous hole only. The public *service* reads
-- (`listActive`, `getByKey`) already filter in SQL, so no page and no API route
-- exposes an unlisted plan.
--
-- `plan_features` needs no fourth policy: `20261119140000` renamed the table to
-- `plan_entitlements`, and its policy moved with it.
-- ==========================================================

-- ==========================================================
-- 1. `subscription_plans`: the anon half of the public read.
-- ==========================================================
drop policy if exists "Public pricing read" on public.subscription_plans;
drop policy if exists "Public listed pricing read" on public.subscription_plans;

create policy "Public pricing read" on public.subscription_plans
  for select to authenticated
  using (true);

create policy "Public listed pricing read" on public.subscription_plans
  for select to anon
  using (visibility = 'public' and is_active);

-- ==========================================================
-- 2. `plan_entitlements`: anon sees the rows of a listed, active plan only.
-- ==========================================================
drop policy if exists "Public pricing read" on public.plan_entitlements;
drop policy if exists "Public listed pricing read" on public.plan_entitlements;

create policy "Public pricing read" on public.plan_entitlements
  for select to authenticated
  using (true);

create policy "Public listed pricing read" on public.plan_entitlements
  for select to anon
  using (
    exists (
      select 1
      from public.subscription_plans p
      where p.key = plan_entitlements.plan_key
        and p.visibility = 'public'
        and p.is_active
    )
  );

-- ==========================================================
-- 3. `plan_limits`: the same parent predicate.
-- ==========================================================
drop policy if exists "Public pricing read" on public.plan_limits;
drop policy if exists "Public listed pricing read" on public.plan_limits;

create policy "Public pricing read" on public.plan_limits
  for select to authenticated
  using (true);

create policy "Public listed pricing read" on public.plan_limits
  for select to anon
  using (
    exists (
      select 1
      from public.subscription_plans p
      where p.key = plan_limits.plan_key
        and p.visibility = 'public'
        and p.is_active
    )
  );

-- ==========================================================
-- 4. `assign_plan_to_org` loses its `42501` branch.
--
-- The function inserts the pin before it tests the move, so the assignment arm
-- of that test is always true once the insert returns: `on conflict do nothing`
-- leaves an existing row in place and a clean insert creates one. The branch
-- could not fire. The scope refusal (`22023`) that runs before the insert, the
-- idempotent pin and the move are unchanged.
--
-- The definition is re-asserted here because the file that carried the dead
-- branch is already applied on a running stack; this is the definition a replay
-- ends on either way.
-- ==========================================================
create or replace function public.assign_plan_to_org(p_plan_key text, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
DECLARE
  v_scope text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan_key) THEN
    RAISE EXCEPTION 'plan % not found', p_plan_key USING ERRCODE = 'P0002';
  END IF;

  SELECT scope INTO v_scope FROM public.subscription_plans WHERE key = p_plan_key;

  IF v_scope <> 'organization' THEN
    RAISE EXCEPTION
      'plan % has scope %, but an organization plan is required', p_plan_key, v_scope
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.plan_assignments (plan_key, organization_id)
  VALUES (p_plan_key, p_org_id)
  ON CONFLICT DO NOTHING;

  UPDATE public.organizations SET plan = p_plan_key WHERE id = p_org_id;
END;
$$;

revoke all on function public.assign_plan_to_org(text, uuid) from public, anon, authenticated;
grant execute on function public.assign_plan_to_org(text, uuid) to service_role;

-- ==========================================================
-- 5. Closing guard (R26): the anon read cannot widen again, the signed-in read
--    stays whole, and the webhook's only organization writer keeps the
--    assignment refusal.
-- ==========================================================
do $$
declare
  v_table text;
  v_qual text;
  v_count int;
  v_body text;
begin
  -- Each table carries exactly one anon SELECT policy after this file, and it
  -- names the two column predicates. The child tables reach the parent through
  -- an `exists`, so their qual carries the same two names.
  for v_table in
    select tablename from (values
      ('subscription_plans'), ('plan_entitlements'), ('plan_limits')
    ) as pricing(tablename)
  loop
    select count(*), min(qual) into v_count, v_qual
    from pg_policies
    where schemaname = 'public'
      and tablename = v_table
      and cmd = 'SELECT'
      and roles @> array['anon']::name[];
    if v_count <> 1 then
      raise exception 'guard: % has % anon SELECT policy/policies (expected 1)', v_table, v_count
        using errcode = '42501';
    end if;
    if v_qual is null
       or position('visibility' in v_qual) = 0
       or position('is_active' in v_qual) = 0 then
      raise exception 'guard: the anon policy on % does not filter on visibility/is_active', v_table
        using errcode = '42501';
    end if;
  end loop;

  -- `authenticated` keeps the whole catalogue: /me/plan must resolve an
  -- unlisted plan for the organization that holds it.
  select count(*) into v_count
  from pg_policies
  where schemaname = 'public'
    and tablename in ('subscription_plans', 'plan_entitlements', 'plan_limits')
    and cmd = 'SELECT'
    and roles @> array['authenticated']::name[]
    and qual = 'true';
  if v_count <> 3 then
    raise exception 'guard: % of 3 signed-in pricing reads lost their whole-table policy', v_count
      using errcode = '42501';
  end if;

  -- The grant stays: the public pricing page reads these tables as anon.
  if not has_table_privilege('anon', 'public.subscription_plans', 'SELECT')
     or not has_table_privilege('anon', 'public.plan_entitlements', 'SELECT')
     or not has_table_privilege('anon', 'public.plan_limits', 'SELECT') then
    raise exception 'guard: anon lost the SELECT grant on a pricing table'
      using errcode = '42501';
  end if;

  -- `assign_plan_to_org`: no unreachable refusal, and both writes stay.
  v_body := lower(pg_get_functiondef('public.assign_plan_to_org(text,uuid)'::regprocedure));
  if position('42501' in v_body) > 0 then
    raise exception 'guard: assign_plan_to_org still carries the unreachable 42501 branch'
      using errcode = '42883';
  end if;
  if position('insert into public.plan_assignments' in v_body) = 0
     or position('update public.organizations set plan' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org lost the pin or the move'
      using errcode = '42883';
  end if;

  -- The webhook's organization write goes through `change_org_plan`
  -- (`apply_entitlement_fenced`), so its assignment refusal is the guard the
  -- fenced path relies on.
  v_body := lower(pg_get_functiondef('public.change_org_plan(uuid,text)'::regprocedure));
  if position('plan_assignments' in v_body) = 0
     or position('42501' in v_body) = 0 then
    raise exception 'guard: change_org_plan lost the assignment refusal'
      using errcode = '42883';
  end if;
end $$;
