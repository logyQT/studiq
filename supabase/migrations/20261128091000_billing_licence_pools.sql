-- ==========================================================
-- #1511 PR1: the subscription mirror can describe a seat pool.
--
-- One active subscription per organization is the current rule
-- (`billing_subscriptions_one_active_organization`). An organization with a plan
-- and three licence pools needs four active rows, so the index gains one
-- discriminator: the pool id, or the literal `plan` for the organization's own
-- plan row.
--
--   * `licence_pool_id` links the mirror to `org_seat_pools`. `on delete
--     restrict` keeps a pool that a live subscription bills.
--   * `quantity` is what the provider bills. The pool's `total` is the product
--     truth (paid seats); the webhook writes both, so a mismatch is visible.
--
-- PR1 writes no mirror row. The purchase path and the webhook branch follow in
-- PR3; this file only makes the schema able to hold them.
-- ==========================================================

-- ==========================================================
-- 1. The two columns. `if not exists` keeps the file replayable.
-- ==========================================================
alter table public.billing_subscriptions
  add column if not exists licence_pool_id uuid
    references public.org_seat_pools(id) on delete restrict;

alter table public.billing_subscriptions
  add column if not exists quantity integer not null default 1;

comment on column public.billing_subscriptions.licence_pool_id is
  'The seat pool this subscription bills. NULL for the organization plan row.';
comment on column public.billing_subscriptions.quantity is
  'The provider quantity: 1 for a plan row, N for a pool row. `org_seat_pools.total` '
  'is the product truth; the webhook writes both.';

-- ==========================================================
-- 2. The widened unique index. The discriminator is the pool id, or `plan` for
--    the organization's own row, so one organization keeps one active plan row
--    and one active row per pool.
-- ==========================================================
drop index if exists public.billing_subscriptions_one_active_organization;

create unique index billing_subscriptions_one_active_organization
  on public.billing_subscriptions (
    organization_id,
    coalesce(licence_pool_id::text, 'plan'),
    livemode
  )
  where organization_id is not null
    and status in ('active', 'trialing', 'past_due');

-- A pool read filters by owner and pool, so the index keeps a lookup cheap.
create index if not exists billing_subscriptions_licence_pool_idx
  on public.billing_subscriptions (licence_pool_id)
  where licence_pool_id is not null;

-- ==========================================================
-- 3. Closing guard (R26): the index and the foreign key carry the rule the
--    purchase path will rely on.
-- ==========================================================
do $$
declare
  v_indexdef text;
  v_delete_rule "char";
  v_notnull boolean;
  v_default text;
begin
  select indexdef into v_indexdef
  from pg_indexes
  where schemaname = 'public'
    and indexname = 'billing_subscriptions_one_active_organization';

  if v_indexdef is null
     or position('licence_pool_id' in v_indexdef) = 0
     or position('coalesce' in lower(v_indexdef)) = 0 then
    raise exception 'guard: the organization-active index does not discriminate on the pool'
      using errcode = '23514';
  end if;

  select c.confdeltype into v_delete_rule
  from pg_constraint c
  where c.conrelid = 'public.billing_subscriptions'::regclass
    and c.contype = 'f'
    and c.confrelid = 'public.org_seat_pools'::regclass;
  if v_delete_rule is distinct from 'r' then
    raise exception 'guard: billing_subscriptions.licence_pool_id is not on delete restrict'
      using errcode = '23514';
  end if;

  select a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_notnull, v_default
  from pg_attribute a
  left join pg_attrdef d
    on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attrelid = 'public.billing_subscriptions'::regclass
    and a.attname = 'quantity'
    and not a.attisdropped;
  if v_notnull is not true or v_default is distinct from '1' then
    raise exception 'guard: billing_subscriptions.quantity is not int not null default 1'
      using errcode = '23514';
  end if;
end $$;
