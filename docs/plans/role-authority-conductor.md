# Role-authority conductor

Phase-gated orchestration for `exp/role-authority`. No calendar gates: a phase
is dispatched when its dependencies are merged, and merged when its gate passes.

The conductor is the only process allowed to merge into `exp/role-authority`.
Phase agents work on `feat/ra-*` branches and open PRs into the exp branch.

## Files

- `scripts/role-authority-conductor` — state machine and gate checks.
- `.role-authority/state.json` — local state (gitignored). Set `RA_STATE` to a
  durable path (for example `/workspaces/studiq/.role-authority/state.json`) if
  the conductor worktree may rotate.
- `docs/plans/role-authority-rollout.md` — phase definitions and exit criteria.
- `docs/plans/role-authority-conductor.md` — this file.

## Shared exp infrastructure

The conductor expects a `scripts/exp` tool (or `$EXP_TOOL`) with:

```text
scripts/exp up                     # shared Supabase + build cache
scripts/exp status --json          # health, ports, URLs
scripts/exp env                    # export EXP_SUPABASE_* / EXP_APP_URL
scripts/exp build <worktree>       # prod build only, serialized
scripts/exp serve <worktree> <port># next start, never next dev
scripts/exp lease-port             # allocate an app port
scripts/exp reset --yes            # conductor-only shared DB reset
```

Rules for agents:

- Never run `next dev`.
- Never run `supabase db reset` against the shared DB.
- Build with `scripts/exp build`; serve with `scripts/exp serve`.
- One build at a time; `scripts/exp` owns the lock and memory cap.
- Shared DB, per-agent tenant; schema migrations are applied by the conductor.

The conductor works without `scripts/exp` for `status`/`next`/`dispatch`, but
agents cannot run the stack until it exists.

## Commands

```bash
scripts/role-authority-conductor init
scripts/role-authority-conductor status
scripts/role-authority-conductor next
scripts/role-authority-conductor dispatch <phase>
scripts/role-authority-conductor qa <phase>
scripts/role-authority-conductor gate <phase>
scripts/role-authority-conductor merge <phase> --yes
scripts/role-authority-conductor ask "question" --phase <n>
scripts/role-authority-conductor answer <id> "answer"
scripts/role-authority-conductor protect
scripts/role-authority-conductor check
```

## Phase flow

1. `next` — verify dependencies, no open phase PRs, no blocking ambiguities.
2. `dispatch <n>` — create `.worktrees/ra-<n>-<name>` on `feat/ra-<n>-<name>`
   from `origin/exp/role-authority`.
3. Design subagent → coder → adversarial review loop inside that branch.
4. Push and open a PR into `exp/role-authority`.
5. `qa <n>` — run the phase’s minimum QA subset against the shared exp app and
   record the result.
6. `gate <n>` — required checks green, QA green, no blocking ambiguities.
7. `merge <n> --yes` — squash-merge into exp and delete the phase branch.

## Ambiguity gate

The conductor must ask before dispatching a phase when:

- the design doc and code disagree;
- a migration order or schema decision is not in the ADR;
- a QA case encodes a bug and the new expected behaviour is not in the ADR;
- a phase changes a product decision outside ADR-0008.

Record it with `ask`; `dispatch` and `gate` refuse while a blocking item is
unanswered.

## Branch protection

`protect` sets on `exp/role-authority`:

- required PR, no direct pushes;
- required checks: `checks`, `unit`, `integration`;
- required approvals: 0 (conductor autonomy);
- linear history, conversation resolution;
- no force push, no deletion;
- admins may bypass only so the conductor can merge.

## QA gating on exp

The full QA job is intentionally skipped for PRs whose base is
`exp/role-authority` until the model can pass it. `check` verifies the condition
exists in `.github/workflows/verify.yml`; the final `exp` → `main` PR has base
`main`, so the full suite runs there.

Phase QA is run explicitly with `qa <phase>` and recorded in
`.role-authority/state.json`. It is not replaced by “the full suite is red but
we will fix it later”.
