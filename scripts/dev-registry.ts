#!/usr/bin/env bun
/**
 * scripts/dev-registry.ts — per-checkout local-stack registry for `scripts/dev`.
 *
 * Several checkouts (and therefore several Supabase stacks) can run on one
 * machine. This registry records which checkout owns which project id and port
 * block, so `scripts/dev` can fail with "owned by /path" instead of silently
 * reusing — or worse, stopping — another checkout's stack.
 *
 * Entries live outside the repository (default
 * `${XDG_RUNTIME_DIR:-${TMPDIR:-/tmp}}/studiq-dev-$(id -u)`), one JSON file per
 * project id. Paths recorded here are absolute paths of the checkout; they are
 * runtime state and are never committed.
 *
 * Usage:
 *   bun scripts/dev-registry.ts write --dir DIR --project-id ID --worktree PATH ...
 *   bun scripts/dev-registry.ts list  --dir DIR [--format json|tsv]
 *   bun scripts/dev-registry.ts get   --dir DIR --project-id ID [--format json|tsv]
 *   bun scripts/dev-registry.ts remove --dir DIR --project-id ID
 *
 * `scripts/dev` consumes `--format tsv` (tab-separated, one entry per line) so
 * bash never has to parse JSON. The field order is `FIELDS`, exported for the
 * shell side to mirror.
 */
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

/** Field order of `--format tsv`; `scripts/dev` mirrors this list. */
const FIELDS = [
  'projectId',
  'worktree',
  'appPort',
  'apiPort',
  'dbPort',
  'studioPort',
  'mailPort',
  'shadowPort',
  'poolerPort',
  'analyticsPort',
  'edgeInspectorPort',
  'ownerPid',
  'startedAt',
  'shared',
  'sharedOwner',
  'mode',
  'claimId',
] as const;

type Field = (typeof FIELDS)[number];

interface Entry {
  projectId: string;
  worktree: string;
  appPort: number;
  apiPort: number;
  dbPort: number;
  studioPort: number;
  mailPort: number;
  shadowPort: number;
  poolerPort: number;
  analyticsPort: number;
  edgeInspectorPort: number;
  ownerPid: number;
  startedAt: string;
  shared: boolean;
  sharedOwner: string | null;
  mode: 'dev' | 'prod';
  /** Identity of the invocation that created the claim; null on old entries. */
  claimId: string | null;
}

interface Args {
  command: string;
  dir?: string;
  projectId?: string;
  worktree?: string;
  format: 'json' | 'tsv';
  values: Record<string, string>;
}

const PROJECT_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function fail(message: string): never {
  console.error(`dev-registry: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): Args {
  const [command = '', ...rest] = argv;
  const args: Args = { command, format: 'json', values: {} };

  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith('--')) {
      fail(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = rest[i + 1];
    if (next === undefined || next.startsWith('--')) {
      fail(`--${key} needs a value`);
    }
    i += 1;

    if (key === 'dir') args.dir = next;
    else if (key === 'project-id') args.projectId = next;
    else if (key === 'worktree') args.worktree = next;
    else if (key === 'format') {
      if (next !== 'json' && next !== 'tsv') fail(`--format must be json or tsv (got ${next})`);
      args.format = next;
    } else args.values[key] = next;
  }

  return args;
}

function requireDir(args: Args): string {
  if (!args.dir) fail('--dir is required');
  return args.dir;
}

function requireProjectId(args: Args): string {
  if (!args.projectId) fail('--project-id is required');
  if (!PROJECT_ID_RE.test(args.projectId)) {
    fail(`invalid project id '${args.projectId}' (allowed: a-z 0-9 -)`);
  }
  return args.projectId;
}

function entryPath(dir: string, projectId: string): string {
  return join(dir, `${projectId}.json`);
}

/** The project id encoded in the file name; entries must not disagree with it. */
function entryIdFromPath(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? '';
  return name.endsWith('.json') ? name.slice(0, -'.json'.length) : name;
}

function toNumber(name: string, raw: string | undefined, max = 65535): number {
  if (raw === undefined || raw === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0 || value > max) {
    fail(`--${name} must be an integer between 0 and ${max} (got ${raw})`);
  }
  return value;
}

function readEntry(file: string): Entry | null {
  try {
    // Never read through a symlink: a precreated registry entry could otherwise
    // point at any file the developer can read.
    if (lstatSync(file).isSymbolicLink()) return null;
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<Entry>;
    if (typeof parsed.projectId !== 'string' || !PROJECT_ID_RE.test(parsed.projectId)) return null;
    if (parsed.projectId !== entryIdFromPath(file)) return null;
    return {
      projectId: parsed.projectId,
      worktree: typeof parsed.worktree === 'string' ? parsed.worktree : '',
      appPort: Number(parsed.appPort) || 0,
      apiPort: Number(parsed.apiPort) || 0,
      dbPort: Number(parsed.dbPort) || 0,
      studioPort: Number(parsed.studioPort) || 0,
      mailPort: Number(parsed.mailPort) || 0,
      shadowPort: Number(parsed.shadowPort) || 0,
      poolerPort: Number(parsed.poolerPort) || 0,
      analyticsPort: Number(parsed.analyticsPort) || 0,
      edgeInspectorPort: Number(parsed.edgeInspectorPort) || 0,
      ownerPid: Number(parsed.ownerPid) || 0,
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : '',
      shared: parsed.shared === true,
      sharedOwner:
        typeof parsed.sharedOwner === 'string' && parsed.sharedOwner ? parsed.sharedOwner : null,
      mode: parsed.mode === 'prod' ? 'prod' : 'dev',
      claimId: typeof parsed.claimId === 'string' && parsed.claimId ? parsed.claimId : null,
    };
  } catch {
    return null;
  }
}

function listEntries(dir: string): Entry[] {
  if (!existsSync(dir)) return [];
  const entries: Entry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    const file = join(dir, name);
    try {
      if (!lstatSync(file).isFile()) continue;
    } catch {
      continue;
    }
    const entry = readEntry(file);
    if (entry) entries.push(entry);
  }
  return entries.sort((a, b) => a.projectId.localeCompare(b.projectId));
}

function tsvValue(entry: Entry, field: Field): string {
  const value = entry[field];
  if (value === null || value === undefined) return '';
  return String(value).replace(/[\t\r\n]+/g, ' ');
}

function printEntry(entry: Entry, format: 'json' | 'tsv'): void {
  if (format === 'tsv') {
    console.log(FIELDS.map((field) => tsvValue(entry, field)).join('\t'));
    return;
  }
  console.log(JSON.stringify(entry, null, 2));
}

function writeEntry(args: Args): void {
  const dir = requireDir(args);
  const projectId = requireProjectId(args);
  if (!args.worktree) fail('--worktree is required');

  const entry: Entry = {
    projectId,
    worktree: args.worktree,
    appPort: toNumber('app-port', args.values['app-port']),
    apiPort: toNumber('api-port', args.values['api-port']),
    dbPort: toNumber('db-port', args.values['db-port']),
    studioPort: toNumber('studio-port', args.values['studio-port']),
    mailPort: toNumber('mail-port', args.values['mail-port']),
    shadowPort: toNumber('shadow-port', args.values['shadow-port']),
    poolerPort: toNumber('pooler-port', args.values['pooler-port']),
    analyticsPort: toNumber('analytics-port', args.values['analytics-port']),
    edgeInspectorPort: toNumber('edge-inspector-port', args.values['edge-inspector-port']),
    ownerPid: toNumber('owner-pid', args.values['owner-pid'], 2_147_483_647),
    startedAt: args.values['started-at'] || new Date().toISOString(),
    shared: args.values.shared === '1',
    sharedOwner: args.values['shared-owner'] || null,
    mode: args.values.mode === 'prod' ? 'prod' : 'dev',
    claimId: args.values['claim-id'] || null,
  };

  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Direct invocations bypass scripts/dev's shell guard, so re-check the
  // directory here: a symlink or a directory owned by another local user must
  // not receive registry writes (or a temp-file symlink write).
  const dirStat = lstatSync(dir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    fail(`registry directory ${dir} is not a real directory`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && dirStat.uid !== uid) {
    fail(`registry directory ${dir} is not owned by the current user`);
  }
  const file = entryPath(dir, projectId);
  const payload = `${JSON.stringify(entry, null, 2)}\n`;

  if (args.values.exclusive === '1') {
    // Atomic claim: O_EXCL fails when another checkout already owns the entry.
    try {
      writeFileSync(file, payload, { mode: 0o600, flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') process.exit(2);
      fail(`cannot create ${file}: ${(error as Error).message}`);
    }
  } else {
    const tmp = `${file}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmp, payload, { mode: 0o600, flag: 'wx' });
    renameSync(tmp, file);
  }
  printEntry(entry, args.format);
}

function listCommand(args: Args): void {
  const dir = requireDir(args);
  const entries = listEntries(dir);
  if (args.format === 'tsv') {
    for (const entry of entries) printEntry(entry, 'tsv');
    return;
  }
  console.log(JSON.stringify(entries, null, 2));
}

function getCommand(args: Args): void {
  const dir = requireDir(args);
  const projectId = requireProjectId(args);
  const entry = readEntry(entryPath(dir, projectId));
  if (!entry) process.exit(1);
  printEntry(entry, args.format);
}

function removeCommand(args: Args): void {
  const dir = requireDir(args);
  const projectId = requireProjectId(args);
  const file = entryPath(dir, projectId);
  if (!existsSync(file)) return;
  rmSync(file, { force: true });
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  switch (args.command) {
    case 'write':
      writeEntry(args);
      break;
    case 'list':
      listCommand(args);
      break;
    case 'get':
      getCommand(args);
      break;
    case 'remove':
      removeCommand(args);
      break;
    case 'fields':
      console.log(FIELDS.join(' '));
      break;
    case '':
    case 'help':
    case '--help':
      console.log(
        [
          'Usage: bun scripts/dev-registry.ts <write|list|get|remove|fields> [options]',
          '',
          '  --dir DIR            registry directory (required for write/list/get/remove)',
          '  --project-id ID      Supabase project id (required for write/get/remove)',
          '  --worktree PATH      absolute checkout path (required for write)',
          '  --format json|tsv    output format (default: json)',
          '',
          'write-only ports/PID flags: --app-port --api-port --db-port --studio-port',
          '  --mail-port --shadow-port --pooler-port --analytics-port',
          '  --edge-inspector-port --owner-pid --started-at --shared 0|1',
          '  --shared-owner NAME --mode dev|prod --exclusive 1 --claim-id TOKEN',
        ].join('\n'),
      );
      break;
    default:
      fail(`unknown command '${args.command}'`);
  }
}

main();
