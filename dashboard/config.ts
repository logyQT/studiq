/**
 * Shared configuration for the StudiQ QA dashboard, browser supervisor and
 * agent browser tooling.  No dependencies beyond Bun/Node built-ins.
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export const PORT = 5000;
export const HOSTNAME = '0.0.0.0';
export const UPSTREAM = 'http://127.0.0.1:4096';
export const UPSTREAM_AUTH =
  'Basic ' + Buffer.from('opencode:studiq-local-dev', 'utf8').toString('base64');

export const REPO_ROOT = '/workspaces/studiq';
export const DASHBOARD_DIR = import.meta.dir;
export const PUBLIC_DIR = join(DASHBOARD_DIR, 'public');
export const DECISIONS_FILE = join(REPO_ROOT, '.worktrees/qa-env/qa/decisions.json');
export const MANAGER_TOOL = join(REPO_ROOT, '.worktrees/qa-env/qa/tools/qa-manager.py');

export const BROWSER_WIDTH = 1920;
export const BROWSER_HEIGHT = 1080;

/** Chromium shipped with the Playwright cache in the container. */
export const CHROME_PATH =
  process.env.QA_CHROME_PATH ??
  '/home/node/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome';

export const BROWSERS_FILE = join(DASHBOARD_DIR, 'browsers.json');
export const TABS_FILE = join(DASHBOARD_DIR, 'tabs.json');
export const PROFILES_DIR = join(DASHBOARD_DIR, '.profiles');
export const SHOTS_DIR = join(DASHBOARD_DIR, 'shots');
export const LOGS_DIR = join(DASHBOARD_DIR, 'logs');
export const SESSIONS_FILE = join(DASHBOARD_DIR, 'sessions.json');

export type EnvConfig = {
  n: number;
  name: string;
  directory: string;
  origin: string;
  serverKey: string;
  webUrl: string;
  adminUrl: string;
  cdpPort: number;
  cdpUrl: string;
  profileDir: string;
  startUrl: string;
};

export const SLOT_COUNT = Number(process.env.QA_SLOTS ?? 8);

export const ENVS: EnvConfig[] = Array.from({ length: SLOT_COUNT }, (_, i) => i + 1).map((n) => {
  const name = `qa-env-${n}`;
  const origin = `http://${name}.localhost:${PORT}`;
  return {
    n,
    name,
    directory: `${REPO_ROOT}/.worktrees/${name}`,
    origin,
    // The SPA route is /server/:serverKey/session/:id and compares the
    // decoded key against the current origin. base64(origin) is exactly
    // what the bundled client uses for its "local server" key.
    serverKey: Buffer.from(origin, 'utf8').toString('base64'),
    webUrl: `http://localhost:${3009 + n}`,
    adminUrl: `http://localhost:${4009 + n}`,
    cdpPort: 9220 + n,
    cdpUrl: `http://127.0.0.1:${9220 + n}`,
    profileDir: join(PROFILES_DIR, name),
    startUrl: `http://localhost:${3009 + n}`,
  };
});

export function envByN(n: number): EnvConfig | undefined {
  return ENVS.find((env) => env.n === n);
}

export function envByName(name: string): EnvConfig | undefined {
  const clean = name.trim().replace(/^qa-env-?/i, '');
  const n = Number(clean);
  if (!Number.isInteger(n)) return undefined;
  return envByN(n);
}

export function ensureDirs(): void {
  for (const dir of [PROFILES_DIR, SHOTS_DIR, LOGS_DIR]) {
    mkdirSync(dir, { recursive: true });
  }
}

export function isInsideDashboard(path: string): boolean {
  const norm = path.replaceAll('\\', '/');
  return norm.startsWith(DASHBOARD_DIR.replaceAll('\\', '/'));
}
