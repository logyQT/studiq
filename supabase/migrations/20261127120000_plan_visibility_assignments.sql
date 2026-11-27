-- ==========================================================
-- #1495 (B3): a sales-led contract plan is an ordinary catalogue row that the
-- public never sees and that only the assigned organizations may hold.
--
-- Three additions, no new entitlement layer and no per-org override table:
--
--   * `subscription_plans.visibility` (`public` | `unlisted`) hides a plan from
--     every public read. `is_active` stays the operational kill switch.
--   * `subscription_plans.billing_mode` (`stripe` | `invoice` | `none`) says how
--     a plan may be paid for. `stripe` is the only self-serve mode today; the
--     column exists so a later private-subscription or invoice path is a value,
--     not a rewrite of the checkout rule.
--   * `plan_assignments (plan_key, organization_id)` pins an unlisted plan to
--     one or more organizations. `change_org_plan` refuses an unlisted plan for
--     an organization that is not on its list.
--
-- The eight catalogue plans keep `public` / `stripe` from the column defaults;
-- this file inserts no plan row.
--
-- Catalogue durability: a later matrix sweep that deletes every plan the matrix
-- does not list must add `and visibility = 'public'` (or an equivalent
-- predicate) to its `delete from public.subscription_plans`, because a contract
-- plan is created at runtime by an admin. The six sweeps and targeted deletes
-- written before this column are allowlisted in
-- `__tests__/unit/guards/plan-catalog-sweep.test.ts`
-- (`20260924000002`, `20261125170000`, `20261126130000`, `20261126160000`,
-- `20261126170000`, `20261127090000`); that guard fails a new sweep without the
-- predicate. The allowlist matches a file name, so a sweep appended to one of
-- those six files passes the guard: a new statement belongs in a new file.
-- ==========================================================

-- ==========================================================
-- 1. The two plan columns. `if not exists` and `drop constraint if exists` keep
--    the file replayable; the defaults make every existing row public and
--    Stripe-billed without a data write.
-- ==========================================================
alter table public.subscription_plans
  add column if not exists visibility text not null default 'public';
alter table public.subscription_plans
  add column if not exists billing_mode text not null default 'stripe';

alter table public.subscription_plans
  drop constraint if exists subscription_plans_visibility_check;
alter table public.subscription_plans
  add constraint subscription_plans_visibility_check
  check (visibility in ('public', 'unlisted'));

alter table public.subscription_plans
  drop constraint if exists subscription_plans_billing_mode_check;
alter table public.subscription_plans
  add constraint subscription_plans_billing_mode_check
  check (billing_mode in ('stripe', 'invoice', 'none'));

comment on column public.subscription_plans.visibility is
  'public = listed in every public pricing read; unlisted = sales-led contract '
  'plan, visible only to its assigned organizations and the admin panel.';
comment on column public.subscription_plans.billing_mode is
  'stripe = self-serve checkout; invoice / none = sales-led, never bought '
  'through checkout.';

-- ==========================================================
-- 2. `plan_assignments`: the pin. Many-to-many, so two organizations can share
--    one contract. The plan side is `on delete restrict`, so a referenced plan
--    cannot be deleted; the organization side cascades with the organization.
-- ==========================================================
create table if not exists public.plan_assignments (
  plan_key        text not null
                  references public.subscription_plans(key) on delete restrict,
  organization_id uuid not null
                  references public.organizations(id) on delete cascade,
  created_at      timestamptz not null default now(),
  primary key (plan_key, organization_id)
);

-- The admin panel and `change_org_plan` read this table with the service role.
-- No policy exists, so a signed-in or anonymous client reads nothing even if a
-- later migration restores a table grant.
alter table public.plan_assignments enable row level security;
revoke all on table public.plan_assignments from anon, authenticated;
grant all on table public.plan_assignments to service_role;

-- ==========================================================
-- 3. A direct SQL delete cannot orphan an organization on a plan it may no
--    longer be assigned to. The service checks the same rule first and answers
--    409 CONFLICT; this trigger is the backstop for a hand-written delete.
-- ==========================================================
create or replace function public.plan_assignments_refuse_planned_org_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.organizations
    where id = old.organization_id
      and plan = old.plan_key
  ) then
    raise exception
      'plan % is the current plan of organization % — move the organization first',
      old.plan_key, old.organization_id
      using errcode = '23503';
  end if;
  return old;
end;
$$;

revoke all on function public.plan_assignments_refuse_planned_org_delete()
  from public, anon, authenticated;
grant execute on function public.plan_assignments_refuse_planned_org_delete()
  to service_role;

drop trigger if exists plan_assignments_refuse_planned_org_delete
  on public.plan_assignments;
create trigger plan_assignments_refuse_planned_org_delete
  before delete on public.plan_assignments
  for each row
  execute function public.plan_assignments_refuse_planned_org_delete();

-- ==========================================================
-- 4. `change_org_plan` gains one guard and keeps the rest of its body: the move
--    of `organizations.plan` is the whole write. An unlisted plan is refused for
--    an organization that has no assignment row.
-- ==========================================================
create or replace function public.change_org_plan(p_org_id uuid, p_plan text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_org_id) THEN
    RAISE EXCEPTION 'organization % not found', p_org_id USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE key = p_plan) THEN
    RAISE EXCEPTION 'plan % not found', p_plan USING ERRCODE = 'P0002';
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
-- 5. Closing guard (R26): pin what this file creates, and re-assert the
--    `change_org_plan` properties the previous definition carried, so a later
--    file that rewrites the function cannot silently drop either half.
-- ==========================================================
do $$
declare
  v_bad int;
  v_body text;
  v_forbidden text;
  v_check text;
begin
  -- Both columns exist, are NOT NULL, and default to the public/self-serve pair.
  select count(*) into v_bad
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'subscription_plans'
    and (
      (column_name = 'visibility'
        and is_nullable = 'NO'
        and column_default = '''public''::text')
      or
      (column_name = 'billing_mode'
        and is_nullable = 'NO'
        and column_default = '''stripe''::text')
    );
  if v_bad <> 2 then
    raise exception 'guard: subscription_plans lost visibility/billing_mode (% of 2 found)', v_bad
      using errcode = '23514';
  end if;

  -- The CHECKs name the allowed values; a dropped constraint fails here.
  select pg_get_constraintdef(oid) into v_check
  from pg_constraint
  where conrelid = 'public.subscription_plans'::regclass
    and conname = 'subscription_plans_visibility_check';
  if v_check is null
     or position('public' in v_check) = 0
     or position('unlisted' in v_check) = 0 then
    raise exception 'guard: subscription_plans.visibility has no public/unlisted CHECK'
      using errcode = '23514';
  end if;

  select pg_get_constraintdef(oid) into v_check
  from pg_constraint
  where conrelid = 'public.subscription_plans'::regclass
    and conname = 'subscription_plans_billing_mode_check';
  if v_check is null
     or position('stripe' in v_check) = 0
     or position('invoice' in v_check) = 0
     or position('none' in v_check) = 0 then
    raise exception 'guard: subscription_plans.billing_mode has no stripe/invoice/none CHECK'
      using errcode = '23514';
  end if;

  -- `plan_assignments` exists with both foreign keys, RLS on and no anon grant.
  if to_regclass('public.plan_assignments') is null then
    raise exception 'guard: plan_assignments is missing' using errcode = '23514';
  end if;

  select count(*) into v_bad
  from pg_constraint
  where conrelid = 'public.plan_assignments'::regclass
    and contype = 'f';
  if v_bad <> 2 then
    raise exception 'guard: plan_assignments has % foreign key(s) (expected 2)', v_bad
      using errcode = '23514';
  end if;

  select count(*) into v_bad
  from pg_class
  where oid = 'public.plan_assignments'::regclass and relrowsecurity;
  if v_bad <> 1 then
    raise exception 'guard: plan_assignments has RLS disabled' using errcode = '23514';
  end if;

  if has_table_privilege('anon', 'public.plan_assignments', 'SELECT')
     or has_table_privilege('authenticated', 'public.plan_assignments', 'SELECT') then
    raise exception 'guard: plan_assignments is readable outside the service role'
      using errcode = '23514';
  end if;

  -- The eight catalogue plans stay public and Stripe-billed. A contract plan
  -- created later is free to be unlisted; the defaults put the matrix first.
  select count(*) into v_bad
  from (values
    ('free'), ('plus'), ('pro'), ('max'),
    ('launch'), ('team'), ('hub'), ('campus')
  ) as expected(key)
  left join public.subscription_plans pl on pl.key = expected.key
  where pl.key is null
     or pl.visibility is distinct from 'public'
     or pl.billing_mode is distinct from 'stripe';
  if v_bad <> 0 then
    raise exception 'guard: % catalogue plan(s) are not public/stripe', v_bad
      using errcode = '23514';
  end if;

  -- `change_org_plan` still moves the plan and nothing else, and carries the
  -- assignment guard.
  v_body := lower(pg_get_functiondef('public.change_org_plan(uuid,text)'::regprocedure));
  if position('update public.organizations set plan' in v_body) = 0 then
    raise exception 'guard: change_org_plan does not move organizations.plan'
      using errcode = '42883';
  end if;
  if position('plan_assignments' in v_body) = 0 then
    raise exception 'guard: change_org_plan has no assignment guard'
      using errcode = '42883';
  end if;
  foreach v_forbidden in array array[
    'org_role_features',
    'plan_limits',
    'org_role_permissions',
    'plan_entitlements'
  ] loop
    if position(v_forbidden in v_body) > 0 then
      raise exception 'guard: change_org_plan still writes %', v_forbidden
        using errcode = '42883';
    end if;
  end loop;
end $$;
