-- Phase 7 of the role-authority programme (ADR-0015 R29/R41).
--
-- Daily AI token accounting used to be a read-modify-write in
-- `packages/server/src/services/limits.ts#trackTokenUsage`: select the day's
-- totals, add the stream's tokens, update. READ COMMITTED gives each statement
-- a fresh snapshot, so two concurrent streams could both read the same total
-- and each write `old + own`, losing one increment and passing the ceiling.
-- `reserve_ai_tokens` folds the check and the write into one self-guarding
-- statement. The actor is `auth.uid()` *inside* the function: a caller can
-- meter itself and never another user (R41). Execute is `authenticated` only;
-- `security definer` + an empty `search_path` keeps the write independent of
-- the caller's RLS and of any shadowed name.
create or replace function public.reserve_ai_tokens(
  p_day date,
  p_input_tokens integer,
  p_output_tokens integer,
  p_limit integer
)
returns table (accepted boolean, input_total integer, output_total integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_input integer;
  v_output integer;
begin
  if v_actor is null then
    raise exception 'reserve_ai_tokens requires an authenticated actor'
      using errcode = '28000';
  end if;

  -- One statement: the `insert … select … where` guards a fresh day's row and
  -- `on conflict … do update … where` guards the increment. A concurrent
  -- reservation blocks on the row, then re-evaluates the `where` against the
  -- committed totals, so the ceiling cannot be overshot.
  with written as (
    insert into public.user_daily_activity as activity
      (user_id, date, ai_input_tokens, ai_output_tokens)
    select v_actor, p_day, p_input_tokens, p_output_tokens
    where p_limit = -1 or p_input_tokens + p_output_tokens <= p_limit
    on conflict (user_id, date) do update
      set ai_input_tokens = activity.ai_input_tokens + excluded.ai_input_tokens,
          ai_output_tokens = activity.ai_output_tokens + excluded.ai_output_tokens
      where p_limit = -1
         or activity.ai_input_tokens
          + activity.ai_output_tokens
          + excluded.ai_input_tokens
          + excluded.ai_output_tokens <= p_limit
    returning ai_input_tokens, ai_output_tokens
  )
  select true, written.ai_input_tokens, written.ai_output_tokens
    into accepted, v_input, v_output
    from written;

  if not found then
    -- A refusal is a domain answer, not an error: report the totals the caller
    -- is actually at. This read runs after the guarded write returned no row,
    -- so it cannot be used to pass the ceiling (the ceiling is never in TS).
    accepted := false;
    select a.ai_input_tokens, a.ai_output_tokens
      into v_input, v_output
      from public.user_daily_activity a
      where a.user_id = v_actor and a.date = p_day;
  end if;

  input_total := coalesce(v_input, 0);
  output_total := coalesce(v_output, 0);
  return next;
end;
$$;

revoke all on function public.reserve_ai_tokens(date, integer, integer, integer) from public;
revoke all on function public.reserve_ai_tokens(date, integer, integer, integer) from anon;
revoke all on function public.reserve_ai_tokens(date, integer, integer, integer) from service_role;
grant execute on function public.reserve_ai_tokens(date, integer, integer, integer) to authenticated;

-- Closing guard (R26): the function exists with the safety properties the
-- callsite relies on, and the table it writes is still the one `getUsage`
-- reads.
do $$
declare
  v_oid oid := 'public.reserve_ai_tokens(date,integer,integer,integer)'::regprocedure;
  v_proc pg_proc;
  v_body text;
begin
  if to_regclass('public.user_daily_activity') is null then
    raise exception 'user_daily_activity is missing';
  end if;

  select * into v_proc from pg_proc where oid = v_oid;
  if v_proc is null then
    raise exception 'reserve_ai_tokens(date,integer,integer,integer) is missing';
  end if;

  if not v_proc.prosecdef then
    raise exception 'reserve_ai_tokens must be security definer';
  end if;
  if not exists (
    select 1 from unnest(v_proc.proconfig) as setting where setting like 'search_path=%'
  ) then
    raise exception 'reserve_ai_tokens must pin an empty search_path';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.reserve_ai_tokens(date,integer,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute reserve_ai_tokens';
  end if;
  if has_function_privilege(
    'anon',
    'public.reserve_ai_tokens(date,integer,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'anon must not execute reserve_ai_tokens';
  end if;
  if has_function_privilege(
    'service_role',
    'public.reserve_ai_tokens(date,integer,integer,integer)',
    'EXECUTE'
  ) then
    raise exception 'service_role must not execute reserve_ai_tokens';
  end if;

  v_body := lower(v_proc.prosrc);
  -- The actor is derived inside; no user-id parameter can meter someone else.
  if position('auth.uid()' in v_body) = 0 then
    raise exception 'reserve_ai_tokens does not derive the actor from auth.uid()';
  end if;
  if position('on conflict' in v_body) = 0 or position('do update' in v_body) = 0 then
    raise exception 'reserve_ai_tokens is not an upsert';
  end if;
  if position('user_daily_activity' in v_body) = 0 then
    raise exception 'reserve_ai_tokens does not write user_daily_activity';
  end if;

  -- The ceiling must be evaluated in the guarded statement, not in a prior
  -- read: both the insert branch and the conflict branch name `p_limit`.
  if (length(v_body) - length(replace(v_body, 'p_limit', ''))) / length('p_limit') < 2 then
    raise exception 'reserve_ai_tokens does not guard both insert and conflict branches';
  end if;
end;
$$;
