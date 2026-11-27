-- ==========================================================
-- #1495 (B3) follow-up: assigning an organization also moves it onto the plan.
--
-- `plan_assignments` alone pins the plan but grants nothing until
-- `organizations.plan` names it. The admin panel has no caller identity and no
-- plan-move step, so the two writes must be one operation: a linked plan that
-- grants nothing is a contract the operator believes is live.
--
-- `assign_plan_to_org` inserts the pin (`on conflict do nothing`, so a second
-- call is a no-op) and moves the organization in the same transaction. It is
-- security definer with an empty `search_path`, like `change_org_plan`, and only
-- the service role executes it.
--
-- It does not replace `change_org_plan`: that function still owns every later
-- move, and still refuses an unlisted plan for an organization with no pin.
-- Ending a contract is therefore "move the organization to another plan, then
-- remove the pin" — the order the unpin trigger already enforces.
-- ==========================================================

create or replace function public.assign_plan_to_org(p_plan_key text, p_org_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan_key) THEN
    RAISE EXCEPTION 'plan % not found', p_plan_key USING ERRCODE = 'P0002';
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
-- Closing guard (R26): the function exists, is definer-only, both writes are in
-- its body, and the execute grant is the service role alone.
-- ==========================================================
do $$
declare
  v_body text;
  v_proc pg_proc;
begin
  if to_regprocedure('public.assign_plan_to_org(text,uuid)') is null then
    raise exception 'guard: assign_plan_to_org is missing' using errcode = '42883';
  end if;

  select * into v_proc
  from pg_proc
  where oid = 'public.assign_plan_to_org(text,uuid)'::regprocedure;

  if not v_proc.prosecdef then
    raise exception 'guard: assign_plan_to_org is not security definer' using errcode = '42883';
  end if;
  if v_proc.proconfig is null or not exists (
    select 1 from unnest(v_proc.proconfig) as setting where setting = 'search_path=""'
  ) then
    raise exception 'guard: assign_plan_to_org has no empty search_path' using errcode = '42883';
  end if;

  v_body := lower(pg_get_functiondef('public.assign_plan_to_org(text,uuid)'::regprocedure));
  if position('insert into public.plan_assignments' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org does not insert the pin' using errcode = '42883';
  end if;
  if position('update public.organizations set plan' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org does not move the organization' using errcode = '42883';
  end if;
  if position('on conflict do nothing' in v_body) = 0 then
    raise exception 'guard: assign_plan_to_org is not idempotent' using errcode = '42883';
  end if;

  if not has_function_privilege('service_role', v_proc.oid, 'EXECUTE') then
    raise exception 'guard: service_role cannot execute assign_plan_to_org' using errcode = '42501';
  end if;
  if has_function_privilege('anon', v_proc.oid, 'EXECUTE')
     or has_function_privilege('authenticated', v_proc.oid, 'EXECUTE') then
    raise exception 'guard: assign_plan_to_org is executable outside the service role' using errcode = '42501';
  end if;
end $$;
