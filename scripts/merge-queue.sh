#!/usr/bin/env bash
# Serialized merge queue for a branch whose protection requires an up-to-date head.
#
# `main` uses a ruleset with `strict_required_status_checks_policy`, so a PR may
# only merge when its head is level with `main` **and** every required check is
# green. Merging one PR moves `main`, so the next one is behind again and has to
# be updated and re-checked. This script runs that loop, one PR at a time, and
# never two merges concurrently.
#
# GitHub's native merge queue is not available on this repository (user-owned;
# the ruleset API rejects a `merge_queue` rule and GraphQL returns
# `mergeQueue: null`), so the serialization lives here. `verify.yml` already
# handles a `merge_group` run, so switching to the native queue later is a
# settings change, not a workflow change.
#
# Usage:
#   bun run merge:queue once             # drain the queue file, then exit
#   bun run merge:queue daemon           # keep draining as the file grows
#   bun run merge:queue run <pr>         # merge one PR now
#   bun run merge:queue status           # queue file + per-PR verdicts
#
# Queue file: `.dev/merge-queue.txt`, one PR number per line, in landing order.
# `#` starts a comment, so an entry can be held by commenting it out. The daemon
# re-reads the file every loop.
#
# Exit codes: 0 drained, 1 halted (conflict, failing check, draft, timeout),
# 2 bad usage.
set -uo pipefail

REPO_DIR=$(git rev-parse --show-toplevel 2>/dev/null) || {
  echo "merge-queue: run this inside the repository" >&2
  exit 2
}
cd "$REPO_DIR" || exit 2

DEV_DIR=${DEV_DIR:-$REPO_DIR/.dev}
QUEUE_FILE=${QUEUE_FILE:-$DEV_DIR/merge-queue.txt}
STATE_DIR=${STATE_DIR:-$DEV_DIR/merge-queue}
LOG=${LOG:-$STATE_DIR/queue.log}
MERGE_METHOD=${MERGE_METHOD:-squash}
POLL_SECONDS=${POLL_SECONDS:-45}
PR_TIMEOUT_SECONDS=${PR_TIMEOUT_SECONDS:-2700}
DRY_RUN=${DRY_RUN:-0}

mkdir -p "$STATE_DIR" || exit 2

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*" >>"$LOG"; }
# Progress goes to both the terminal and the log, so a background run is
# inspectable without losing the live view.
say() { printf '%s\n' "$*"; log "$*"; }

# The required contexts come from the branch's own rules, so this script cannot
# drift from the ruleset. The fallback is what `main` requires today.
required_contexts() {
  local contexts
  contexts=$(gh api "repos/{owner}/{repo}/rules/branches/${BASE_BRANCH:-main}" \
    --jq '[.[]|select(.type=="required_status_checks")|.parameters.required_status_checks[].context]' 2>/dev/null)
  if [ -z "$contexts" ] || [ "$contexts" = "null" ]; then
    contexts='["checks","unit","integration","e2e (chromium)","e2e (firefox)"]'
  fi
  printf '%s' "$contexts"
}

record() { # record <pr> <verdict> <detail>
  printf '{"pr":%s,"verdict":"%s","detail":%s,"at":"%s"}\n' \
    "$1" "$2" "$(printf '%s' "$3" | jq -R -s .)" "$(date -u +%FT%TZ)" >"$STATE_DIR/$1.json"
}

pr_field() { gh pr view "$1" --json "$2" --jq ".$2" 2>/dev/null; }

required_green() {
  gh pr checks "$1" --json name,state 2>/dev/null | jq -e --argjson req "$REQUIRED_JSON" '
    . as $all | all($req[]; . as $n | any($all[]; .name == $n and .state == "SUCCESS"))' >/dev/null 2>&1
}

any_failed() {
  gh pr checks "$1" --json name,state 2>/dev/null | jq -e '
    any(.[]; .state == "FAILURE" or .state == "CANCELLED" or .state == "TIMED_OUT" or .state == "ERROR")' \
    >/dev/null 2>&1
}

wait_for_head() { # wait_for_head <pr> <old-sha>
  local pr=$1 old=$2 deadline=$((SECONDS + 300)) sha
  while [ "$SECONDS" -lt "$deadline" ]; do
    sha=$(pr_field "$pr" headRefOid)
    [ -n "$sha" ] && [ "$sha" != "$old" ] && return 0
    sleep 5
  done
  return 1
}

merge_one() {
  local pr=$1 start=$SECONDS state mergeable ms old
  REQUIRED_JSON=$(required_contexts)

  state=$(pr_field "$pr" state)
  if [ "$state" = "MERGED" ]; then
    say "#$pr already merged"
    record "$pr" MERGED "already merged"
    return 0
  fi
  if [ "$state" != "OPEN" ]; then
    say "#$pr is $state - halting"
    record "$pr" BLOCKED "state=$state"
    return 1
  fi

  while [ $((SECONDS - start)) -lt "$PR_TIMEOUT_SECONDS" ]; do
    mergeable=$(pr_field "$pr" mergeable)
    ms=$(pr_field "$pr" mergeStateStatus)

    case "$ms" in
      CLEAN|HAS_HOOKS)
        if required_green "$pr"; then
          if [ "$DRY_RUN" = "1" ]; then
            say "#$pr: green, would merge ($MERGE_METHOD) [dry run]"
            record "$pr" DRY_RUN "green"
            return 0
          fi
          say "#$pr: required checks green, merging ($MERGE_METHOD)"
          if gh pr merge "$pr" --"$MERGE_METHOD" --delete-branch >>"$LOG" 2>&1; then
            local sha
            sha=$(gh pr view "$pr" --json mergeCommit --jq '.mergeCommit.oid[0:8]')
            say "#$pr: MERGED $sha"
            record "$pr" MERGED "$MERGE_METHOD merge"
            return 0
          fi
          say "#$pr: merge command failed, retrying"
        else
          if any_failed "$pr"; then
            say "#$pr: a required check failed - halting"
            record "$pr" BLOCKED "check failure"
            return 1
          fi
          say "#$pr: waiting for required checks"
        fi
        ;;
      BEHIND)
        old=$(pr_field "$pr" headRefOid)
        say "#$pr: behind $BASE_BRANCH, updating (was ${old:0:8})"
        if [ "$DRY_RUN" = "1" ]; then
          say "#$pr: would update the branch [dry run]"
          return 0
        fi
        if ! gh pr update-branch "$pr" --rebase >>"$LOG" 2>&1; then
          say "#$pr: update-branch failed - manual rebase needed (conflict?)"
          record "$pr" BLOCKED "update-branch failed (conflict)"
          return 1
        fi
        wait_for_head "$pr" "$old" || say "#$pr: head did not move yet, continuing to poll"
        ;;
      DIRTY)
        say "#$pr: CONFLICTING with $BASE_BRANCH - manual rebase needed"
        record "$pr" BLOCKED "conflicting"
        return 1
        ;;
      BLOCKED)
        if any_failed "$pr"; then
          say "#$pr: blocked by a failed required check - halting"
          record "$pr" BLOCKED "check failure"
          return 1
        fi
        say "#$pr: blocked (pending checks or review), waiting"
        ;;
      DRAFT)
        say "#$pr: draft - halting"
        record "$pr" BLOCKED "draft"
        return 1
        ;;
      *)
        say "#$pr: state=$ms mergeable=$mergeable, waiting"
        ;;
    esac
    sleep "$POLL_SECONDS"
  done

  say "#$pr: timed out after ${PR_TIMEOUT_SECONDS}s"
  record "$pr" TIMEOUT "no green merge within budget"
  return 1
}

queue_entries() { # commented lines are held, not merged
  sed 's/#.*//' "$QUEUE_FILE" 2>/dev/null | tr -d ' \t\r' | grep -v '^$'
}

cmd_once() {
  say "queue: $QUEUE_FILE (one pass)"
  local pr st
  for pr in $(queue_entries); do
    st=$(pr_field "$pr" state)
    if [ "$st" = "MERGED" ] || [ "$st" = "CLOSED" ]; then
      say "#$pr already $st, skipping"
      continue
    fi
    say "--- #$pr ---"
    merge_one "$pr" || { say "queue halts at #$pr"; return 1; }
  done
  say "queue drained"
  return 0
}

cmd_daemon() {
  say "queue: $QUEUE_FILE (daemon)"
  local seen=""
  while :; do
    local pr
    for pr in $(queue_entries); do
      case " $seen " in *" $pr "*) continue ;; esac
      local st
      st=$(pr_field "$pr" state)
      if [ "$st" = "MERGED" ] || [ "$st" = "CLOSED" ]; then seen="$seen $pr"; continue; fi
      say "--- #$pr ---"
      if merge_one "$pr"; then seen="$seen $pr"; else say "queue halts at #$pr"; exit 1; fi
    done
    sleep "$POLL_SECONDS"
  done
}

cmd_status() {
  echo "queue: $QUEUE_FILE"
  sed 's/^/  /' "$QUEUE_FILE" 2>/dev/null || echo "  (missing)"
  echo "state:"
  for f in "$STATE_DIR"/*.json; do
    [ -e "$f" ] || continue
    printf '  %s\n' "$(cat "$f")"
  done
}

BASE_BRANCH=${BASE_BRANCH:-main}
case "${1:-}" in
  once) cmd_once ;;
  daemon) cmd_daemon ;;
  run) shift; [ $# -ge 1 ] || { echo "usage: $0 run <pr>" >&2; exit 2; }; merge_one "$1" ;;
  status) cmd_status ;;
  *) echo "usage: $0 {once|daemon|run <pr>|status}" >&2; exit 2 ;;
esac
