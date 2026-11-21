-- ADR-0015 phase 3a / D8: `entitlement_flags` is a kill switch only. The
-- rollout percentage never staged a rollout (no users to stage), so the column
-- goes — the CHECK constraint goes with it. A missing flag row fails closed in
-- the resolver, so the row itself must stay: `is_enabled = false` is the only
-- kill-switch operation, deleting a row is not one.

alter table public.entitlement_flags drop column if exists rollout_percentage;

do $$
declare
  v_present int;
begin
  select count(*) into v_present
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'entitlement_flags'
    and column_name = 'rollout_percentage';
  if v_present <> 0 then
    raise exception 'entitlement_flags.rollout_percentage is still present';
  end if;
end;
$$;
