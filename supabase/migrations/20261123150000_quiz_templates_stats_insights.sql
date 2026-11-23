-- Phase 5d of the role-authority programme (ADR-0015 §5.1/§7; the plan's
-- phase-5 register row 12). The last two ungated surface entitlements get
-- their product names, their flag rows and their enforcement in the same
-- slice:
--
--   quiz.builder    -> quiz.templates   (the saved-quiz library: the writes on
--                                          /api/v1/teacher/quizzes are gated on
--                                          it from this slice; the reads stay open)
--   advanced.stats  -> stats.insights   (the diagnostic stats reads:
--                                          /api/v1/stats/student/insights,
--                                          /stats/weak-points, /stats/teacher/groups,
--                                          /stats/teacher/activity, /stats/teacher/feed)
--
-- Neither key had a code call site before this slice, so the rename is
-- data-only: catalog, flags, plan rows and (defensively) the row-sourced
-- children move; the TS catalog in packages/authz renames in the same PR.
--
-- Statement order matters for the FKs (measured on the branch's live stack):
--   plan_entitlements.entitlement_key -> entitlement_catalog(key)  NO ACTION
--   plan_entitlements.entitlement_key -> entitlement_flags(key)    ON DELETE CASCADE
--   user_feature_overrides.feature_key  -> entitlement_flags(key)  ON DELETE CASCADE
--   org_role_features.feature_key       -> (no FK)
-- so the new catalog rows come first, the children move next, and the old
-- flag rows — whose delete would cascade onto any child still pointing at
-- them — go only once no child does. `db push` runs no seeds, so no plan key
-- is hard-coded anywhere below.

-- Captured before the move so the closing guard can assert "no plan lost a
-- row" against real counts instead of a hard-coded plan list. `both_*` counts
-- the plans carrying old and new together (a defensive shape: the unique key
-- makes the move delete that duplicate first).
create temp table phase5d_plan_move as
select
  (select count(*) from public.plan_entitlements where entitlement_key = 'quiz.builder')::int
    as old_quiz,
  (select count(*) from public.plan_entitlements where entitlement_key = 'quiz.templates')::int
    as new_quiz,
  (
    select count(*)
    from public.plan_entitlements a
    join public.plan_entitlements b on b.plan_key = a.plan_key
    where a.entitlement_key = 'quiz.builder' and b.entitlement_key = 'quiz.templates'
  )::int as both_quiz,
  (select count(*) from public.plan_entitlements where entitlement_key = 'advanced.stats')::int
    as old_stats,
  (select count(*) from public.plan_entitlements where entitlement_key = 'stats.insights')::int
    as new_stats,
  (
    select count(*)
    from public.plan_entitlements a
    join public.plan_entitlements b on b.plan_key = a.plan_key
    where a.entitlement_key = 'advanced.stats' and b.entitlement_key = 'stats.insights'
  )::int as both_stats;

-- ==========================================
-- 1. The two new catalog rows — same metadata as the keys they replace
--    (surface, personal, seat-eligible, personal-portable, no quota).
-- ==========================================
insert into public.entitlement_catalog
  (key, category, scope, seat_eligible, personal_portable, quota_limit_key)
values
  ('quiz.templates', 'surface', 'personal', true, true, null),
  ('stats.insights', 'surface', 'personal', true, true, null)
on conflict (key) do nothing;

-- ==========================================
-- 2. Their flag rows. The resolver fail-closes a `category: 'surface'` key
--    with no enabled `entitlement_flags` row (entitlement.resolver.ts step
--    11), so both rows must exist and be enabled or every new gate refuses
--    everyone and `/features/me` never lists the keys.
-- ==========================================
insert into public.entitlement_flags (key, name, description, is_enabled) values
  ('quiz.templates', 'Saved quiz library', 'Save quizzes and reuse them across assignments', true),
  ('stats.insights', 'Insights & weak points', 'Weak points, retention and class-activity diagnostics', true)
on conflict (key) do nothing;

-- ==========================================
-- 3. Move the plan_entitlements children old -> new. A plan that somehow
--    carries both keys would violate UNIQUE(plan_key, entitlement_key), so
--    the target-plan duplicate row is deleted first.
-- ==========================================
delete from public.plan_entitlements
where entitlement_key = 'quiz.templates'
  and plan_key in (
    select plan_key from public.plan_entitlements where entitlement_key = 'quiz.builder'
  );
update public.plan_entitlements
set entitlement_key = 'quiz.templates'
where entitlement_key = 'quiz.builder';

delete from public.plan_entitlements
where entitlement_key = 'stats.insights'
  and plan_key in (
    select plan_key from public.plan_entitlements where entitlement_key = 'advanced.stats'
  );
update public.plan_entitlements
set entitlement_key = 'stats.insights'
where entitlement_key = 'advanced.stats';

-- ==========================================
-- 4. Defensive child moves: `org_role_features` has no FK on `feature_key`,
--    and `user_feature_overrides` cascades on the flag delete, so both move
--    before step 5. (Both are empty of these keys on a seeded stack; the
--    moves keep a hand-written row from being cascade-deleted instead.)
-- ==========================================
update public.org_role_features
set feature_key = 'quiz.templates'
where feature_key = 'quiz.builder';
update public.org_role_features
set feature_key = 'stats.insights'
where feature_key = 'advanced.stats';
update public.user_feature_overrides
set feature_key = 'quiz.templates'
where feature_key = 'quiz.builder';
update public.user_feature_overrides
set feature_key = 'stats.insights'
where feature_key = 'advanced.stats';

-- ==========================================
-- 5. The old flag rows (now childless — their delete would cascade) and
--    then the old catalog rows (NO ACTION: no plan row may point at them).
-- ==========================================
delete from public.entitlement_flags where key in ('quiz.builder', 'advanced.stats');
delete from public.entitlement_catalog where key in ('quiz.builder', 'advanced.stats');

-- ==========================================
-- Closing guard (R26): assert the outcome, not a substring. Replayable on a
-- fresh `db reset` (migrations run once, in order, on an empty database) and
-- on a re-run of this file: the expected count is old + new − both, which on
-- a first run (new = 0, both = 0) is exactly "count(new) == count(old)
-- captured before the move".
-- ==========================================
do $$
declare
  v_leftover int;
  v_cat_quiz int;
  v_cat_stats int;
  v_flag_quiz int;
  v_flag_stats int;
  v_expected_quiz int;
  v_expected_stats int;
  v_after_quiz int;
  v_after_stats int;
  v_old_quiz int;
  v_new_quiz int;
  v_both_quiz int;
  v_old_stats int;
  v_new_stats int;
  v_both_stats int;
begin
  -- The old keys are absent from all five tables that carried them.
  select count(*) into v_leftover from (
    select key from public.entitlement_catalog
      where key in ('quiz.builder', 'advanced.stats')
    union all
    select key from public.entitlement_flags
      where key in ('quiz.builder', 'advanced.stats')
    union all
    select entitlement_key from public.plan_entitlements
      where entitlement_key in ('quiz.builder', 'advanced.stats')
    union all
    select feature_key from public.org_role_features
      where feature_key in ('quiz.builder', 'advanced.stats')
    union all
    select feature_key from public.user_feature_overrides
      where feature_key in ('quiz.builder', 'advanced.stats')
  ) leftovers;
  if v_leftover <> 0 then
    raise exception 'old entitlement keys still present in % row(s)', v_leftover;
  end if;

  -- Both new keys are in the catalog with the metadata of the keys they
  -- replace (surface / personal / seat-eligible / personal-portable / no quota).
  select count(*) into v_cat_quiz from public.entitlement_catalog
  where key = 'quiz.templates'
    and category = 'surface'
    and scope = 'personal'
    and seat_eligible
    and personal_portable
    and quota_limit_key is null;
  if v_cat_quiz <> 1 then
    raise exception 'entitlement_catalog row for quiz.templates missing or wrong (% of 1)', v_cat_quiz;
  end if;

  select count(*) into v_cat_stats from public.entitlement_catalog
  where key = 'stats.insights'
    and category = 'surface'
    and scope = 'personal'
    and seat_eligible
    and personal_portable
    and quota_limit_key is null;
  if v_cat_stats <> 1 then
    raise exception 'entitlement_catalog row for stats.insights missing or wrong (% of 1)', v_cat_stats;
  end if;

  -- Both new keys have an enabled flag row (a missing/disabled row would
  -- fail the resolver closed).
  select count(*) into v_flag_quiz from public.entitlement_flags
  where key = 'quiz.templates' and is_enabled;
  if v_flag_quiz <> 1 then
    raise exception 'enabled entitlement_flags row for quiz.templates missing (% of 1)', v_flag_quiz;
  end if;

  select count(*) into v_flag_stats from public.entitlement_flags
  where key = 'stats.insights' and is_enabled;
  if v_flag_stats <> 1 then
    raise exception 'enabled entitlement_flags row for stats.insights missing (% of 1)', v_flag_stats;
  end if;

  -- No plan lost a row: the new key's plan-row count equals the old key's
  -- captured count (plus any pre-existing new-key rows, minus the deduped
  -- overlap) — no plan key is hard-coded.
  select old_quiz, new_quiz, both_quiz, old_stats, new_stats, both_stats
    into v_old_quiz, v_new_quiz, v_both_quiz, v_old_stats, v_new_stats, v_both_stats
    from phase5d_plan_move;

  v_expected_quiz := v_old_quiz + v_new_quiz - v_both_quiz;
  v_expected_stats := v_old_stats + v_new_stats - v_both_stats;

  select count(*) into v_after_quiz from public.plan_entitlements
  where entitlement_key = 'quiz.templates';
  if v_after_quiz <> v_expected_quiz then
    raise exception 'quiz.templates: % plan row(s) after the move, expected % (old % + new % - both %)',
      v_after_quiz, v_expected_quiz, v_old_quiz, v_new_quiz, v_both_quiz;
  end if;

  select count(*) into v_after_stats from public.plan_entitlements
  where entitlement_key = 'stats.insights';
  if v_after_stats <> v_expected_stats then
    raise exception 'stats.insights: % plan row(s) after the move, expected % (old % + new % - both %)',
      v_after_stats, v_expected_stats, v_old_stats, v_new_stats, v_both_stats;
  end if;
end;
$$;

drop table if exists phase5d_plan_move;
