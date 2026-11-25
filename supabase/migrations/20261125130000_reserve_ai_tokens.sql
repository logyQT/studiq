-- Phase 7 of the role-authority programme (ADR-0015 R29/R41).
--
-- Daily AI token accounting used to be a read-modify-write in
-- `packages/server/src/services/limits.ts#trackTokenUsage`: select the day's
-- totals, add the stream's tokens, update. READ COMMITTED gives each statement
-- a fresh snapshot, so two concurrent streams could both read the same total
-- and each write `old + own`, losing one increment and passing the ceiling.
-- `reserve_ai_tokens` folds the accounting into one statement: a single
-- `insert … on conflict … do update` that always adds to the committed row, so
-- concurrent streams serialize on the row and no increment is lost (R29).
--
-- The write always records the increment. It is *not* a guarded write: by the
-- time it runs the stream has already been served, and refusing the write would
-- leave the stored total sitting just under the ceiling, so the pre-stream
-- `getUsage` gate could never trip and the daily quota would be unbounded in
-- practice. `accepted` is therefore informational — it reports whether this
-- write stayed within `p_limit` — while the stored total is the truth the next
-- `getUsage` reads. One stream may overshoot the ceiling by its own token count;
-- that is the quota's precision, not a bug.
--
-- The actor is `auth.uid()` *inside* the function: a caller can meter itself and
-- never another user (R41). Execute is `authenticated` only; `security definer`
-- + an empty `search_path` keeps the write independent of the caller's RLS and
-- of any shadowed name.
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
begin
  if v_actor is null then
    raise exception 'reserve_ai_tokens requires an authenticated actor'
      using errcode = '28000';
  end if;

  -- Always records: a concurrent reservation blocks on the row and then adds to
  -- the committed totals, so the returned totals are the real, post-write state.
  insert into public.user_daily_activity as activity
    (user_id, date, ai_input_tokens, ai_output_tokens)
  select v_actor, p_day, p_input_tokens, p_output_tokens
  on conflict (user_id, date) do update
    set ai_input_tokens = activity.ai_input_tokens + excluded.ai_input_tokens,
        ai_output_tokens = activity.ai_output_tokens + excluded.ai_output_tokens
  returning activity.ai_input_tokens, activity.ai_output_tokens into input_total, output_total;

  -- Informational only: the increment above is already stored either way.
  accepted := p_limit = -1 or input_total + output_total <= p_limit;
  return next;
end;
$$;

revoke all on function public.reserve_ai_tokens(date, integer, integer, integer) from public;
revoke all on function public.reserve_ai_tokens(date, integer, integer, integer) from anon;
revoke all on function public.reserve_ai_tokens(date, integer, integer, integer) from service_role;
grant execute on function public.reserve_ai_tokens(date, integer, integer, integer) to authenticated;

-- Daily usage is metered by the RPC above and read by `getUsage`; a signed-in
-- user who can DELETE their own row could zero the counter between streams and
-- bypass the gate. No user-facing path deletes activity rows (service-role test
-- cleanup does), so the table grant goes. INSERT/UPDATE stay: the review/quiz
-- stats triggers run as the invoking user and need them; moving those triggers
-- behind a definer function is a separate change, outside phase 7.
revoke delete on public.user_daily_activity from authenticated;

-- Closing guard (R26): the function exists with the properties the callsite
-- relies on, and the table it writes is still the one `getUsage` reads. This
-- checks token presence in the shipped body, not the SQL's behaviour — the
-- behavioural proof lives in `__tests__/integration/reserve-ai-tokens.test.ts`.
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

  -- The counter is writable by the RPC and read by `getUsage`; a client-side
  -- DELETE would wipe the day's usage without going through either.
  if has_table_privilege('authenticated', 'public.user_daily_activity', 'DELETE') then
    raise exception 'authenticated must not delete user_daily_activity';
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

  -- `accepted` must be computed from the totals the write returned, not
  -- hard-coded and not decided before the write.
  if position('input_total + output_total <= p_limit' in v_body) = 0 then
    raise exception 'reserve_ai_tokens does not derive accepted from the stored totals';
  end if;
end;
$$;
