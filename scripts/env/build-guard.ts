#!/usr/bin/env bun
/**
 * The `prebuild` guard for both Next apps (ADR-0014, decision 6).
 *
 * Attached to `apps/web` and `apps/admin` as
 * `"prebuild": "bun ../../scripts/env/build-guard.ts"`, so every route that
 * executes the workspace `build` script — root `bun run build`, `build:web`,
 * `build:admin`, `bun run --filter <app> build`, and `bun run build` inside
 * either app — passes through here before `next build` starts.
 *
 * A build is authorised only by a single-use grant that `env build` minted in
 * the same checkout: the grant names this app, a live launcher (pid + start
 * time), and — unless it is a `--no-slot`/`--no-lock` grant — a slot directory
 * whose token matches and which is live under decision 5's liveness rule. The
 * grant is renamed away and unlinked on first read, so one grant authorises
 * exactly one build and an exported `STUDIQ_BUILD_SLOT` is never consulted.
 *
 * The repo root comes from this file's own location, never from `cwd`: the hook
 * runs with `cwd` = `apps/web` or `apps/admin`. `cwd` is used for exactly one
 * thing — which app is building.
 *
 * Exit codes follow the `env` CLI: 6 (conflict) for every refusal, so a build
 * that cannot prove admission fails before `next build` writes anything.
 */
import { join } from 'node:path';
import { EXIT_CONFLICT } from './lib/exit';
import { consumeBuildGrant, type BuildApp } from './lib/grant';
import {
  describeSlotHolders,
  findSlotByToken,
  formatBuildSlots,
  pidAlive,
  processStartTime,
  readBuildSlots,
} from './lib/locks';
import { writeStderrLine } from './lib/output';
import { REPO_ROOT, canon } from './lib/repo';

const APPS: readonly BuildApp[] = ['web', 'admin'];

/**
 * The command that mints a grant **for this app**.
 *
 * `env:build` builds `apps/web` by default, so telling an admin build to run it
 * would leave the admin build still refused. `env:ensure --profile web` builds
 * web too, which is why the admin text names neither.
 */
function nextCommand(app: BuildApp): string {
  return app === 'admin'
    ? "run 'bun run env:build --app admin'"
    : "run 'bun run env:build' (or 'bun run env:ensure --profile web')";
}

/** The app whose `prebuild` is running, from the hook's working directory. */
function appForCwd(): BuildApp | null {
  const cwd = canon(process.cwd());
  for (const app of APPS) {
    if (cwd === canon(join(REPO_ROOT, 'apps', app))) return app;
  }
  return null;
}

/**
 * Refuse before `next build`: the reason first, then the machine's slot state,
 * so an agent can tell "the machine is busy" from "my grant is wrong".
 */
function refuse(reason: string): never {
  writeStderrLine(`env: ${reason}`);
  const holders = describeSlotHolders();
  writeStderrLine(
    `build slots: ${formatBuildSlots(readBuildSlots())}${holders === '' ? '' : `; ${holders}`}`,
  );
  process.exit(EXIT_CONFLICT);
}

function launcherGone(
  grant: { launcherPid: number; launcherStart: string | null },
  app: BuildApp,
): string | null {
  if (!pidAlive(grant.launcherPid)) {
    return `the build that minted this grant (pid ${grant.launcherPid}) is gone; ${nextCommand(app)}`;
  }
  // A recorded start time is what makes the pid an identity; when the launcher
  // could not read one, the pid alone is the check, exactly like decision 5's
  // slot records.
  if (grant.launcherStart === null) return null;
  const current = processStartTime(grant.launcherPid);
  if (current !== null && current !== grant.launcherStart) {
    return `pid ${grant.launcherPid} now belongs to a different process; ${nextCommand(app)}`;
  }
  return null;
}

function main(): void {
  const app = appForCwd();
  if (app === null) {
    refuse(
      `the build guard runs as the prebuild hook of apps/web or apps/admin, not from ${process.cwd()}; ` +
        "run 'bun run env:build' instead of invoking it directly",
    );
  }

  const consumption = consumeBuildGrant();
  if (consumption.status === 'missing') {
    refuse(`no build grant for this checkout; ${nextCommand(app)}`);
  }
  if (consumption.status === 'invalid') {
    refuse(`the build grant at .dev/build-grant.json is unreadable; ${nextCommand(app)}`);
  }
  const grant = consumption.grant;

  if (grant.app !== app) {
    refuse(
      `the build grant is for apps/${grant.app}, not apps/${app}; run 'bun run env:build --app ${app}'`,
    );
  }

  const expiresAt = Date.parse(grant.expiresAt);
  if (expiresAt <= Date.now()) {
    refuse(`the build grant expired at ${grant.expiresAt}; ${nextCommand(app)}`);
  }

  const gone = launcherGone(grant, app);
  if (gone !== null) refuse(gone);

  if (grant.slot !== null) {
    const slot = findSlotByToken(grant.token);
    if (slot === null) {
      refuse(`the build slot that minted this grant is gone; ${nextCommand(app)}`);
    }
    if (canon(slot.worktree) !== REPO_ROOT) {
      refuse(`the build slot belongs to ${slot.worktree}, not this checkout; ${nextCommand(app)}`);
    }
    if (!slot.live) {
      refuse(
        `build slot ${slot.slot} is no longer live (${slot.reason ?? 'unknown'}); ${nextCommand(app)}`,
      );
    }
    writeStderrLine(
      `build: admitted apps/${app} (slot ${slot.slot}, launcher pid ${grant.launcherPid})`,
    );
    return;
  }

  writeStderrLine(
    `build: admitted apps/${app} (no slot, ${grant.admission}, launcher pid ${grant.launcherPid})`,
  );
}

try {
  main();
} catch (error) {
  writeStderrLine(
    `env: the build guard failed: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(EXIT_CONFLICT);
}
