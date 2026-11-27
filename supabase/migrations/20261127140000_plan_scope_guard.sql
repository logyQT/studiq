-- ==========================================================
-- #1495 (B3) follow-up: an organization's plan must be an organization plan.
--
-- `organizations.plan` is the organization ceiling the resolver reads, so a
-- personal plan there grants personal-plan entitlements to an organization.
-- The `/orgs` plan picker made that a single click, and `change_org_plan` never
-- checked `scope` on an existing key.
--
-- Both writers now refuse a plan whose `scope` is not `'organization'` with
-- `22023` and a message that names the plan and its scope. Every earlier guard
-- stays: existence (`P0002`), the unlisted/assignment pin (`42501`), and
-- `change_org_plan` still writes only `organizations.plan`.
--
-- `assign_plan_to_org` refuses before it inserts, so a personal plan is neither
-- pinned nor moved.
-- ==========================================================

-- ==========================================================
-- 1. `change_org_plan`: existence, then scope, then the assignment pin.
-- ==========================================================
create or replace function public.change_org_plan(p_org_id uuid, p_plan text)
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

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan) THEN
    RAISE EXCEPTION 'plan % not found', p_plan USING ERRCODE = 'P0002';
  END IF;

  SELECT scope INTO v_scope FROM public.subscription_plans WHERE key = p_plan;

  IF v_scope <> 'organization' THEN
    RAISE EXCEPTION
      'plan % has scope %, but an organization plan is required', p_plan, v_scope
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.subscription_plans
    WHERE key = p_plan AND visibility = 'unlisted'
  ) AND NOT EXISTS (
    SELECT 1
    FROM public.plan_assignments
    WHERE plan_key = p_plan AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION
      'plan % is unlisted and not assigned to organization %', p_plan, p_org_id
      USING ERRCODE = '42501';
  END IF;

  -- The org layer is derived live from the plan catalog plus the role's
  -- `entitlement_profile`, so a snapshot write here would only drift.
  UPDATE public.organizations SET plan = p_plan WHERE id = p_org_id;
END;
$$;

revoke all on function public.change_org_plan(uuid, text) from public, anon, authenticated;
grant execute on function public.change_org_plan(uuid, text) to service_role;

-- ==========================================================
-- 2. `assign_plan_to_org`: the same scope check before the pin and the move.
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

  -- The move is legal only when the plan is public or the organization is
  -- pinned to it. The insert above makes the second arm true, so this fails
  -- only when the pin did not land and the plan is unlisted.
  IF NOT EXISTS (
    SELECT 1 FROM public.subscription_plans
    WHERE key = p_plan_key AND visibility = 'public'
  ) AND NOT EXISTS (
    SELECT 1 FROM public.plan_assignments
    WHERE plan_key = p_plan_key AND organization_id = p_org_id
  ) THEN
    RAISE EXCEPTION
      'plan % is unlisted and not assigned to organization %', p_plan_key, p_org_id
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.organizations SET plan = p_plan_key WHERE id = p_org_id;
END;
$$;

revoke all on function public.assign_plan_to_org(text, uuid) from public, anon, authenticated;
grant execute on function public.assign_plan_to_org(text, uuid) to service_role;

-- ==========================================================
-- 3. Closing guard (R26): both bodies carry the scope condition and keep every
--    earlier property; the grants are unchanged.
-- ==========================================================
do $$
declare
  v_body text;
  v_forbidden text;
  v_proc pg_proc;
begin
  if to_regprocedure('public.change_org_plan(uuid,text)') is null then
    raise exception 'guard: change_org_plan is missing' using errcode = '42883';
  end if;
  if to_regprocedure('public.assign_plan_to_org(text,uuid)') is null then
    raise exception 'guard: assign_plan_to_org is missing' using errcode = '42883';
  end if;

  -- `change_org_plan`: scope check, assignment guard, plan move only.
  v_body := lower(pg_get_functiondef('public.change_org_plan(uuid,text)'::regprocedure));
  if position('22023' in v_body) = 0 or position('organization plan is required' in v_body) = 0 then
    raise exception 'guard: change_org_plan has no scope refusal' using errcode = '42883';
  end if;
  if position('update public.organizations set plan' in v_body) = 0 then
    raise exception 'guard: change_org_plan does not move organizations.plan' using errcode = '42883';
  end if;
  if position('plan_assignments' in v_body) = 0 then
    raise exception 'guard: change_org_plan has no assignment guard' using errcode = '42883';
  end if;
  foreach v_forbidden in array array[
    'org_role_features',
    'plan_limits',
    'org_role_permissions',
    'plan_entitlements'
  ] loop
    if position(v_forbidden in v_body) > 0 then
      raise exception 'guard: change_org_plan still writes %', v_forbidden using errcode = '42883';
    end if;
  end loop;

  -- `assign_plan_to_org`: scope check, idempotent pin, the move, one transaction.
  v_body := lower(pg_get_functiondef('public.assign_plan_to_org(text,uuid)'::regprocedure));
  if position('22023' in v_body) = 0 or position('organization plan is required' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org has no scope refusal' using errcode = '42883';
  end if;
  if position('insert into public.plan_assignments' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org does not insert the pin' using errcode = '42883';
  end if;
  if position('update public.organizations set plan' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org does not move the organization' using errcode = '42883';
  end if;
  if position('on conflict do nothing' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org is not idempotent' using errcode = '42883';
  end if;

  -- The scope check runs before the pin: the insert must follow the refusal in
  -- the body, or a personal plan would be pinned before it is refused.
  if position('organization plan is required' in v_body) > position('insert into public.plan_assignments' in v_body) then
    raise exception 'guard: assign_plan_to_org pins before it checks the plan scope' using errcode = '42883';
  end if;

  -- Grants: service role only, for both functions.
  for v_proc in
    select p.*
    from pg_proc p
    where p.oid in (
      'public.change_org_plan(uuid,text)'::regprocedure,
      'public.assign_plan_to_org(text,uuid)'::regprocedure
    )
  loop
    if not v_proc.prosecdef then
      raise exception 'guard: % is not security definer', v_proc.proname using errcode = '42883';
    end if;
    if v_proc.proconfig is null or not exists (
      select 1 from unnest(v_proc.proconfig) as setting where setting = 'search_path=""'
    ) then
      raise exception 'guard: % has no empty search_path', v_proc.proname using errcode = '42883';
    end if;
    if not has_function_privilege('service_role', v_proc.oid, 'EXECUTE') then
      raise exception 'guard: service_role cannot execute %', v_proc.proname using errcode = '42501';
    end if;
    if has_function_privilege('anon', v_proc.oid, 'EXECUTE')
       or has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') then
      raise exception 'guard: % is executable outside the service role', v_proc.proname using errcode = '42501';
    end if;
  end loop;
end $$;
