-- #1482 — the daily-stats counters are written by definer functions only.
--
-- `increment_reviews()` was created without `security definer`, so it ran as the
-- invoking user and needed `INSERT`/`UPDATE` on `public.user_daily_activity`.
-- That grant also let any signed-in user reset their own AI-token meter with a
-- direct PostgREST `UPDATE` or upsert, bypassing the pre-stream `getUsage` gate
-- in `/api/v1/ai/chat`. Phase 7 revoked `DELETE` and recorded the rest as an
-- accepted residual (owner: #1482, `docs/plans/role-authority-plan.md`).
--
-- This file closes the residual: the review trigger becomes `security definer`
-- with an empty `search_path` (same shape as `increment_quizzes` and
-- `reserve_ai_tokens`), and every write grant goes. No user-client caller
-- writes the table: the two trigger functions and `reserve_ai_tokens` do, and
-- service-role test cleanup keeps its grants.
--
-- `increment_quizzes()` already carries both properties (it was replaced by
-- `20261113120000_daily_activity_quizzes.sql`), so its body is not restated here
-- and there is no second copy to keep in step. The closing guard pins it anyway:
-- the revoke is only safe while both triggers are definer functions.
--
-- The row policy "Own activity write" stays. It is no longer the gate — the
-- grant is — but a `FOR ALL` policy also carries the row scope if a grant ever
-- returns, and dropping it would silently widen that future write.

create or replace function public.increment_reviews()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.user_daily_activity (user_id, date, reviews_count, reviews_correct)
  values (new.user_id, new.practiced_at::date, 1, case when new.was_correct then 1 else 0 end)
  on conflict (user_id, date) do update set
    reviews_count = public.user_daily_activity.reviews_count + 1,
    reviews_correct = public.user_daily_activity.reviews_correct + case when new.was_correct then 1 else 0 end;
  return new;
end;
$$;

-- `insert`/`update` were granted for the invoker-rights trigger
-- (`20260630000005_fix_practice_rpc.sql`); `delete` was already revoked in phase
-- 7 and is restated so this file describes the whole table grant on its own.
-- `service_role` and the table owner keep their grants: service-role test
-- cleanup deletes activity rows, and the owner must be able to clean up.
revoke insert, update, delete on public.user_daily_activity from authenticated;
revoke insert, update, delete on public.user_daily_activity from anon;

-- Closing guard (R26): pins the state this file creates, so a later migration
-- that weakens the function or restores a grant cannot leave the suite green.
-- Behaviour (a real practice insert books through the trigger, a real session
-- cannot write the row) lives in `__tests__/integration/reserve-ai-tokens.test.ts`
-- and `__tests__/integration/daily-activity-quizzes.test.ts`.
do $$
declare
  v_read_columns integer;
  v_proc pg_proc;
begin
  if to_regclass('public.user_daily_activity') is null then
    raise exception 'user_daily_activity is missing';
  end if;

  -- `getUsage` and the stats surfaces read these; a guard on an emptied table
  -- would otherwise be vacuously true.
  select count(*) into v_read_columns
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'user_daily_activity'
    and column_name in (
      'user_id',
      'date',
      'reviews_count',
      'reviews_correct',
      'ai_input_tokens',
      'ai_output_tokens'
    );
  if v_read_columns <> 6 then
    raise exception 'user_daily_activity lost a column the stats or getUsage reads';
  end if;

  -- R26: both functions must exist before their properties are asserted.
  if to_regprocedure('public.increment_reviews()') is null then
    raise exception 'increment_reviews() is missing';
  end if;
  if to_regprocedure('public.increment_quizzes()') is null then
    raise exception 'increment_quizzes() is missing';
  end if;

  for v_proc in
    select p.*
    from pg_proc p
    where p.oid in (
      'public.increment_reviews()'::regprocedure,
      'public.increment_quizzes()'::regprocedure
    )
    order by p.proname
  loop
    if not v_proc.prosecdef then
      raise exception '% must be security definer', v_proc.proname;
    end if;
    if not exists (
      select 1 from unnest(v_proc.proconfig) as setting where setting = 'search_path=""'
    ) then
      raise exception '% must pin an empty search_path', v_proc.proname;
    end if;
  end loop;

  -- The grant is the gate: the triggers no longer run as the caller.
  if has_table_privilege('authenticated', 'public.user_daily_activity', 'INSERT') then
    raise exception 'authenticated must not insert user_daily_activity';
  end if;
  if has_table_privilege('authenticated', 'public.user_daily_activity', 'UPDATE') then
    raise exception 'authenticated must not update user_daily_activity';
  end if;
  if has_table_privilege('authenticated', 'public.user_daily_activity', 'DELETE') then
    raise exception 'authenticated must not delete user_daily_activity';
  end if;
  -- RLS still scopes the read to the caller's own row and their org.
  if not has_table_privilege('authenticated', 'public.user_daily_activity', 'SELECT') then
    raise exception 'authenticated lost the SELECT the stats surfaces need';
  end if;

  if has_table_privilege('anon', 'public.user_daily_activity', 'INSERT') then
    raise exception 'anon must not insert user_daily_activity';
  end if;
  if has_table_privilege('anon', 'public.user_daily_activity', 'UPDATE') then
    raise exception 'anon must not update user_daily_activity';
  end if;
  if has_table_privilege('anon', 'public.user_daily_activity', 'DELETE') then
    raise exception 'anon must not delete user_daily_activity';
  end if;

  -- Service-role cleanup and the owner keep their grants.
  if not has_table_privilege('service_role', 'public.user_daily_activity', 'SELECT') then
    raise exception 'service_role lost SELECT on user_daily_activity';
  end if;
  if not has_table_privilege('service_role', 'public.user_daily_activity', 'INSERT') then
    raise exception 'service_role lost INSERT on user_daily_activity';
  end if;
  if not has_table_privilege('service_role', 'public.user_daily_activity', 'UPDATE') then
    raise exception 'service_role lost UPDATE on user_daily_activity';
  end if;
  if not has_table_privilege('service_role', 'public.user_daily_activity', 'DELETE') then
    raise exception 'service_role lost DELETE on user_daily_activity';
  end if;

  -- Token accounting still goes through the RPC.
  if not has_function_privilege(
    'authenticated',
    'public.reserve_ai_tokens(date,integer,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute reserve_ai_tokens';
  end if;

  -- The policy is kept as the row-scope guard for a future grant; its absence
  -- would mean someone dropped it without restoring a scope.
  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'user_daily_activity'
      and policyname = 'Own activity write'
  ) <> 1 then
    raise exception 'the "Own activity write" policy must stay';
  end if;
end;
$$;
