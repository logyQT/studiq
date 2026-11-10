import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { REPO_ROOT } from './repo';

/**
 * Vault seam (spec §11.1). `.env.vault` lives in the **primary checkout**
 * (Git-ignored) and is resolved through `STUDIQ_ENV_VAULT`, defaulting to
 * `<primary>/.env.vault`; `<primary>` is the first entry of
 * `git worktree list --porcelain` (a directory, so the file name is appended).
 *
 * `scripts/env/**` contains no provider code and no ref parsing: the file holds
 * varlock resolver calls (`op(...)`, `bwp(...)`, `infisical(...)`) and varlock
 * resolves them.
 */
export function primaryCheckout(root = REPO_ROOT): string {
  // Git hooks export GIT_DIR/GIT_WORK_TREE; `git -C <temp>` would then answer
  // for the hook's repository instead of `root` (and a test/isolated run could
  // write the vault into the wrong checkout).
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ]) {
    delete env[name];
  }
  const result = spawnSync('git', ['-C', root, 'worktree', 'list', '--porcelain'], {
    encoding: 'utf8',
    timeout: 10_000,
    env,
  });
  if (result.status === 0) {
    for (const line of (result.stdout ?? '').split('\n')) {
      if (line.startsWith('worktree ')) return line.slice('worktree '.length).trim();
    }
  }
  return root;
}

export function vaultFilePath(root = REPO_ROOT): string {
  const explicit = (process.env.STUDIQ_ENV_VAULT ?? '').trim();
  if (explicit) return explicit.startsWith('/') ? explicit : resolve(root, explicit);
  return join(primaryCheckout(root), '.env.vault');
}

export function localEnvFilePath(root = REPO_ROOT): string {
  return join(root, '.env.local');
}

/**
 * The only values that belong in the vault: third-party provider refs that
 * cannot come from the local stack. Everything else lives in `.env.local` or is
 * derived from the stack. This list is deliberately fixed (and deliberately not
 * "every `@sensitive` key"): the Supabase keys/passwords come from the local
 * stack and must not be duplicated in a provider vault.
 */
const VAULT_REF_KEYS = [
  'LLM_API_KEY',
  'LLM_BASE_URL',
  'LLM_PROVIDER',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
] as const;

function atomicWrite(path: string, contents: string, mode = 0o600): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    writeFileSync(temp, contents, { mode, flag: 'wx' });
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
  chmodSync(path, mode);
}

export type ScaffoldResult = 'created' | 'overwritten' | 'unchanged';

const LOCAL_ENV_SCAFFOLD = `# StudiQ local values — created by \`bun run env:setup\`.
# The inventory of every key is in .env.schema; this file is optional and is
# Git-ignored. Uncomment a key to set it, and never commit a value here.
#
# APP_PORT=3000
# SUPABASE_STACK=
# APP_ENV=development
`;

function vaultScaffold(): string {
  const lines = [
    '# StudiQ optional vault pointer — primary checkout only (Git-ignored).',
    '#',
    '# This file is OPT-IN: `.env.local` remains the only required hand-edited',
    '# values file and a fresh checkout runs without this one. Use it only for',
    '# third-party provider refs that cannot come from the local stack: LLM',
    '# inference and Stripe. The Supabase keys/passwords stay in `.env.local` or',
    '# are discovered from the stack, never here.',
    '#',
    '# Values are varlock resolver calls, not literals. The function names the',
    '# provider, so there is no default provider:',
    '#   LLM_API_KEY=op(op://studiq/llm/api-key)',
    '#   STRIPE_SECRET_KEY=bwp("Stripe", field=secret-key)',
    '#   STRIPE_WEBHOOK_SECRET=infisical("STRIPE_WEBHOOK_SECRET")',
    '#',
    '# Uncomment only the keys you use and add their resolver. Never commit this file.',
    '',
  ];
  for (const key of VAULT_REF_KEYS) lines.push(`# ${key}=`);
  return `${lines.join('\n')}\n`;
}

/** Scaffold `.env.local` in this checkout (mode 600, never a value). */
export function scaffoldLocalEnv(root = REPO_ROOT, force = false): ScaffoldResult {
  const path = localEnvFilePath(root);
  const existed = existsSync(path);
  if (existed && !force) return 'unchanged';
  atomicWrite(path, LOCAL_ENV_SCAFFOLD);
  return existed ? 'overwritten' : 'created';
}

/** Scaffold `.env.vault` in the primary checkout (mode 600, never a value). */
export function scaffoldVault(root = REPO_ROOT, force = false): ScaffoldResult {
  const path = vaultFilePath(root);
  const existed = existsSync(path);
  if (existed && !force) return 'unchanged';
  atomicWrite(path, vaultScaffold());
  return existed ? 'overwritten' : 'created';
}
