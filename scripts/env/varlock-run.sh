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
# Mirror `vaultFilePath`: surrounding whitespace makes the value empty (unset).
vault="${vault#"${vault%%[![:space:]]*}"}"
vault="${vault%"${vault##*[![:space:]]}"}"
if [[ -z "$vault" ]]; then
  # Mirror `primaryCheckout`: a git hook exports GIT_DIR/GIT_WORK_TREE, and the
  # lookup must still answer for this checkout. A non-git checkout keeps the
  # fallback instead of aborting under `set -e`.
  primary=''
  if worktrees=$(env -u GIT_DIR -u GIT_WORK_TREE -u GIT_INDEX_FILE \
    -u GIT_OBJECT_DIRECTORY -u GIT_ALTERNATE_OBJECT_DIRECTORIES \
    git -C "$repo_root" worktree list --porcelain 2>/dev/null); then
    primary=$(printf '%s\n' "$worktrees" | awk '/^worktree /{sub(/^worktree /, ""); print; exit}')
  fi
  [[ -n "$primary" ]] || primary=$repo_root
  vault="$primary/.env.vault"
else
  # A relative pointer resolves against the checkout, like `resolve(root, value)`.
  [[ "$vault" = /* ]] || vault="$repo_root/$vault"
fi

if [[ $# -eq 0 ]]; then
  printf 'env: missing command\n' >&2
  exit 2
fi

if [[ -f "$vault" ]]; then
  exec varlock run --inject vars --path "$vault" --path . -- bun scripts/env/cli.ts "$@"
fi
exec varlock run --inject vars -- bun scripts/env/cli.ts "$@"
