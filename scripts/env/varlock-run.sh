#!/usr/bin/env bash
# Varlock wrapper for the value-consuming `env:*` commands.
#
# varlock is the only loader/injector/validator. The vault pointer
# (`.env.vault`) lives in the primary checkout and is resolved through
# `STUDIQ_ENV_VAULT`, defaulting to `<primary>/.env.vault`. A missing `--path`
# is a hard varlock error, so the vault is passed only when the file exists:
#
#   varlock run --inject vars --path "$vault" --path . -- bun <script> <args...>
#
# The vault comes first and the checkout last, so `.env.local` wins on a
# duplicate key. A checkout with no vault runs unchanged (no `--path`).
#
# Usage (from package.json):
#   bash scripts/env/varlock-run.sh <command> [...]
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd -P)
cd "$repo_root"

vault=${STUDIQ_ENV_VAULT:-}
if [[ -z "$vault" ]]; then
  primary=$(git -C "$repo_root" worktree list --porcelain 2>/dev/null | awk '/^worktree /{if (!found) { primary=$2; found=1 }} END{print primary}')
  [[ -n "$primary" ]] || primary=$repo_root
  vault="$primary/.env.vault"
fi

if [[ $# -eq 0 ]]; then
  printf 'env: missing command\n' >&2
  exit 2
fi

if [[ -f "$vault" ]]; then
  exec varlock run --inject vars --path "$vault" --path . -- bun scripts/env/cli.ts "$@"
fi
exec varlock run --inject vars -- bun scripts/env/cli.ts "$@"
