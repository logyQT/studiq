import { readdirSync, type Dirent } from 'node:fs';
import { join, resolve } from 'node:path';
import { redactSecrets } from './output';
import { REPO_ROOT } from './repo';
import { runDatabaseCommand } from './stack';
import type { MigrationsState } from './state';

/**
 * Local migration files against the stack's applied set (#1186).
 *
 * A branch stack does not follow `HEAD`: the CLI applies migrations when it
 * creates the database, so a stack started before a merge keeps its old schema
 * while the code expects the new one, and the symptom is a 500 in an unrelated
 * feature. This module is the one place that compares the two sets.
 *
 * Language: `pending` is a local version the database does not record, `drift`
 * is the opposite (a version the database records that no local file provides,
 * usually after a branch switch), and `unknown` means nothing proves either.
 */
/** `supabase/migrations/`, or the `STUDIQ_MIGRATIONS_DIR` test seam. */
function migrationsDir(): string {
  const override = process.env.STUDIQ_MIGRATIONS_DIR;
  return override ? resolve(REPO_ROOT, override) : join(REPO_ROOT, 'supabase', 'migrations');
}

const MIGRATION_FILE = /^(\d{14})_.*\.sql$/;

export type MigrationState = 'current' | 'pending' | 'drift' | 'unknown' | 'absent';

export interface MigrationsReport {
  state: MigrationState;
  /** Local versions the database does not record. */
  pending: string[];
  /** Versions the database records with no local file. */
  remoteOnly: string[];
  /** When the probe or the record behind this answer ran. */
  checkedAt: string | null;
  /** `probe` is a live read, `record` the last proven apply, `none` no stack. */
  source: 'probe' | 'record' | 'none';
  /** Why the state is `unknown`; null otherwise. */
  reason: string | null;
}

/** The versions present as `supabase/migrations/*.sql` files, sorted. */
export function localMigrationVersions(dir: string = migrationsDir()): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() || entry.isSymbolicLink())
    .map((entry) => MIGRATION_FILE.exec(entry.name)?.[1])
    .filter((version): version is string => version !== undefined)
    .sort();
}

interface MigrationEntry {
  local: string;
  remote: string;
}

/**
 * `supabase migration list --output-format json` prints
 * `{"migrations":[{"local":"…","remote":"…","time":"…"}]}`, with an empty side
 * when that version exists on only one side. Anything else is not a JSON answer
 * and must read as unknown rather than as "no drift".
 *
 * @public Used by the env unit tests, which load this module by a computed URL.
 */
export function parseMigrationList(stdout: string): MigrationEntry[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const migrations = (parsed as Record<string, unknown>).migrations;
  if (!Array.isArray(migrations)) return null;
  const entries: MigrationEntry[] = [];
  for (const item of migrations) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const local = typeof row.local === 'string' ? row.local : '';
    const remote = typeof row.remote === 'string' ? row.remote : '';
    if (local === '' && remote === '') continue;
    entries.push({ local, remote });
  }
  return entries;
}

export interface MigrationProbe {
  ok: boolean;
  pending: string[];
  remoteOnly: string[];
  /** The failure that made this probe unknown; null when it answered. */
  reason: string | null;
}

/**
 * The CLI reports a database failure as JSON on stdout and only its target line
 * on stderr, so the message that names the cause is read from stdout first.
 */
function failureReason(result: { stdout: string; stderr: string; error: string | null }): string {
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const error = (parsed as Record<string, unknown>).error;
      if (error !== null && typeof error === 'object' && !Array.isArray(error)) {
        const message = (error as Record<string, unknown>).message;
        if (typeof message === 'string' && message !== '') return redactSecrets(message);
      }
    }
  } catch {
    /* not JSON: fall through to the spawn error and stderr */
  }
  if (result.error) return redactSecrets(result.error);
  const text = redactSecrets(result.stderr).trim().split('\n').filter(Boolean).pop();
  return text ?? 'the database command failed';
}

/**
 * Read the applied set from the stack's database.
 *
 * The default stack is the CLI's implicit local target, so it needs no URL. A
 * named stack is read through its DB URL because database commands accept no
 * `--stack`; a caller without that URL gets an unknown probe, never a false
 * "current".
 */
export function probeMigrations(options: {
  stackName: string | null;
  dbUrl: string | null;
  timeoutMs?: number;
}): MigrationProbe {
  if (options.stackName && !options.dbUrl) {
    return {
      ok: false,
      pending: [],
      remoteOnly: [],
      reason: `no database URL for stack '${options.stackName}'`,
    };
  }
  const result = runDatabaseCommand(['migration', 'list', '--output-format', 'json'], {
    dbUrl: options.dbUrl,
    timeoutMs: options.timeoutMs ?? 60_000,
  });
  if (!result.ok) {
    return {
      ok: false,
      pending: [],
      remoteOnly: [],
      reason: failureReason(result),
    };
  }
  const entries = parseMigrationList(result.stdout);
  if (entries === null) {
    return {
      ok: false,
      pending: [],
      remoteOnly: [],
      reason: 'migration list did not return the expected JSON',
    };
  }
  return {
    ok: true,
    pending: entries
      .filter((entry) => entry.local !== '' && entry.remote === '')
      .map((entry) => entry.local)
      .sort(),
    remoteOnly: entries
      .filter((entry) => entry.local === '' && entry.remote !== '')
      .map((entry) => entry.remote)
      .sort(),
    reason: null,
  };
}

export interface MigrationApplyResult {
  ok: boolean;
  /** Versions the CLI reported applied, or the pending count when it printed less. */
  applied: string[];
  reason: string | null;
}

/**
 * Apply every pending local migration to this checkout's stack.
 *
 * `--include-all` applies a pending file whose version is older than the newest
 * applied one. That set is routine: a merge adds `20261028100000` above
 * `20261030203549`, and the CLI refuses it as "inserted before the last
 * migration on remote database". The caller refuses a mixed set before this
 * call, so the flag can never insert a version before a remote-only entry; it
 * relaxes the ordering check only for local files.
 */
export function applyMigrations(options: {
  stackName: string | null;
  dbUrl: string | null;
  timeoutMs?: number;
}): MigrationApplyResult {
  if (options.stackName && !options.dbUrl) {
    return { ok: false, applied: [], reason: `no database URL for stack '${options.stackName}'` };
  }
  const result = runDatabaseCommand(
    ['migration', 'up', '--include-all', '--output-format', 'json'],
    {
      dbUrl: options.dbUrl,
      timeoutMs: options.timeoutMs ?? 300_000,
    },
  );
  if (!result.ok) {
    return { ok: false, applied: [], reason: failureReason(result) };
  }
  let paths: string[] = [];
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const applied = (parsed as Record<string, unknown>).applied;
      if (Array.isArray(applied)) {
        paths = applied.filter((path): path is string => typeof path === 'string');
      }
    }
  } catch {
    /* an applied list is a report, not the proof; the re-probe is the proof */
  }
  return {
    ok: true,
    applied: paths
      .map((path) => MIGRATION_FILE.exec(path.split(/[\\/]/).pop() ?? '')?.[1])
      .filter((version): version is string => version !== undefined)
      .sort(),
    reason: null,
  };
}

/** A report from a live probe, at the moment it answered. */
export function probeReport(probe: MigrationProbe, checkedAt: string): MigrationsReport {
  if (!probe.ok) return unknownMigrations(probe.reason);
  return {
    state: probe.pending.length > 0 ? 'pending' : probe.remoteOnly.length > 0 ? 'drift' : 'current',
    pending: probe.pending,
    remoteOnly: probe.remoteOnly,
    checkedAt,
    source: 'probe',
    reason: null,
  };
}

export function unknownMigrations(reason: string | null): MigrationsReport {
  return {
    state: 'unknown',
    pending: [],
    remoteOnly: [],
    checkedAt: null,
    source: 'none',
    reason,
  };
}

export function absentMigrations(): MigrationsReport {
  return {
    state: 'absent',
    pending: [],
    remoteOnly: [],
    checkedAt: null,
    source: 'none',
    reason: null,
  };
}

/**
 * One line an operator can act on, for a report state.
 *
 * The advice must be the step that can resolve *this* state: `ensure` cannot
 * apply on a shared stack, and it refuses a mixed set until a repair runs, so a
 * blanket "run 'bun run env:ensure'" would send the reader in a circle.
 */
export function migrationsLabel(
  report: MigrationsReport,
  options: { shared?: boolean } = {},
): string {
  switch (report.state) {
    case 'current':
      return 'current';
    case 'pending': {
      const pending = `pending ${report.pending.length}`;
      if (report.remoteOnly.length > 0) {
        return `${pending}, drift ${report.remoteOnly.length} — repair first ('bun run env:supa migration repair --status reverted <version>'), then run 'bun run env:ensure'`;
      }
      return `${pending} — run 'bun run env:ensure'`;
    }
    case 'drift':
      return `drift ${report.remoteOnly.length} (the database has versions with no local file) — restore the file, or run 'bun run env:supa migration repair --status reverted <version>'`;
    case 'absent':
      return 'absent (no running stack)';
    case 'unknown': {
      const reason = report.reason ? ` (${report.reason})` : '';
      const action = options.shared ? 'its owner applies migrations' : "run 'bun run env:ensure'";
      return `unknown${reason} — ${action}`;
    }
  }
}

/**
 * The cheap answer `env status` gives from this checkout's record, compared with
 * the local files.
 *
 * A record that no longer matches the local set proves nothing about the stack
 * any more: a new file is `pending` (the bug this closes), a removed file costs
 * a probe because the database may still hold it, and a record from another
 * stack is discarded.
 */
export function classifyMigrations(
  record: MigrationsState | null,
  local: string[],
  stackId: string | null,
): MigrationsReport {
  if (!record) return unknownMigrations('no migration probe covers this stack yet');
  if (stackId === null || record.stackId !== stackId) {
    return unknownMigrations('the recorded migration set belongs to another stack');
  }
  const recorded = new Set(record.versions);
  const pending = local.filter((version) => !recorded.has(version));
  const remoteOnly = record.remoteOnly.filter((version) => !local.includes(version));
  if (pending.length > 0) {
    return {
      state: 'pending',
      pending,
      remoteOnly,
      checkedAt: record.checkedAt,
      source: 'record',
      reason: null,
    };
  }
  if (record.versions.length !== local.length) {
    return unknownMigrations('the local migration files changed since the last probe');
  }
  return {
    state: remoteOnly.length > 0 ? 'drift' : 'current',
    pending: [],
    remoteOnly,
    checkedAt: record.checkedAt,
    source: 'record',
    reason: null,
  };
}
