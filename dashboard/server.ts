/**
 * StudiQ QA Dashboard — Phase 1
 *
 * One Bun server on :4000 that does two things:
 *
 *   1. Dashboard host (localhost:4000, 127.0.0.1:4000, ...)
 *      → 2x2 grid of the four opencode web clients.
 *
 *   2. Tile hosts (qa-env-N.localhost:4000)
 *      → reverse proxy to the local opencode server on 127.0.0.1:4096,
 *        injecting the Basic auth header server-side. The SPA therefore
 *        runs same-origin with its API and never shows an auth prompt.
 *
 * No dependencies beyond Bun itself.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = 4000;
const HOSTNAME = '0.0.0.0';
const UPSTREAM = 'http://127.0.0.1:4096';
const UPSTREAM_AUTH =
  'Basic ' + Buffer.from('opencode:studiq-local-dev', 'utf8').toString('base64');

const REPO_ROOT = '/workspaces/studiq';
const DASHBOARD_DIR = import.meta.dir;
const OVERRIDES_FILE = join(DASHBOARD_DIR, 'sessions.json');

type EnvConfig = {
  n: number;
  name: string;
  directory: string;
  origin: string;
  serverKey: string;
  webUrl: string;
};

const ENVS: EnvConfig[] = [1, 2, 3, 4].map((n) => {
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
  };
});

type Session = {
  id: string;
  title?: string;
  location?: { directory?: string };
  time?: { created?: number; updated?: number };
};

type EnvState = {
  env: EnvConfig;
  session: Session | null;
  source: 'auto' | 'override' | 'none';
  deepLink: string | null;
};

type Cache = { at: number; states: EnvState[] };

let cache: Cache | null = null;
const CACHE_MS = 10_000;

function readOverrides(): Record<string, string> {
  if (!existsSync(OVERRIDES_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(OVERRIDES_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === 'string' && v.length > 0) out[k] = v;
    }
    return out;
  } catch (err) {
    console.error('[dashboard] invalid sessions.json:', err);
    return {};
  }
}

async function fetchSessions(): Promise<Session[]> {
  const res = await fetch(`${UPSTREAM}/api/session`, {
    headers: {
      authorization: UPSTREAM_AUTH,
      accept: 'application/json',
      'accept-encoding': 'identity',
    },
  });
  if (!res.ok) throw new Error(`GET /api/session → ${res.status}`);
  const body = (await res.json()) as { data?: Session[] } | Session[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

function mostRecent(sessions: Session[]): Session | null {
  if (sessions.length === 0) return null;
  return sessions
    .slice()
    .sort(
      (a, b) =>
        (b.time?.updated ?? b.time?.created ?? 0) - (a.time?.updated ?? a.time?.created ?? 0),
    )[0]!;
}

async function loadStates(force = false): Promise<EnvState[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.states;

  const overrides = readOverrides();
  let sessions: Session[] = [];
  let sessionsError: unknown = null;
  try {
    sessions = await fetchSessions();
  } catch (err) {
    sessionsError = err;
    console.error('[dashboard] session discovery failed:', err);
  }

  const byId = new Map(sessions.map((s) => [s.id, s]));
  const states: EnvState[] = ENVS.map((env) => {
    const overrideId = overrides[env.name];
    if (overrideId) {
      const session = byId.get(overrideId) ?? {
        id: overrideId,
        title: `manual override (${overrideId})`,
      };
      return {
        env,
        session,
        source: 'override' as const,
        deepLink: `${env.origin}/server/${env.serverKey}/session/${session.id}`,
      };
    }

    const owned = sessions.filter((s) => normalizeDir(s.location?.directory) === env.directory);
    const session = mostRecent(owned);
    return {
      env,
      session,
      source: session ? ('auto' as const) : ('none' as const),
      deepLink: session ? `${env.origin}/server/${env.serverKey}/session/${session.id}` : null,
    };
  });

  cache = { at: Date.now(), states };
  if (sessionsError && sessions.length === 0) {
    // Keep serving placeholders; the UI offers a retry.
  }
  return states;
}

function normalizeDir(dir: string | undefined): string {
  if (!dir) return '';
  return dir.length > 1 ? dir.replace(/\/+$/, '') : dir;
}

function envFromHost(hostHeader: string | null): EnvConfig | null {
  const host = (hostHeader ?? '').split(':')[0]!.toLowerCase();
  const m = /^qa-env-([1-4])\./.exec(host);
  if (!m) return null;
  const n = Number(m[1]);
  return ENVS.find((e) => e.n === n) ?? null;
}

/* ------------------------------------------------------------------ proxy */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function proxyHeaders(req: Request, env: EnvConfig): Headers {
  const headers = new Headers();
  for (const [key, value] of req.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'host' || lower === 'authorization' || lower === 'content-length') continue;
    headers.set(key, value);
  }
  headers.set('authorization', UPSTREAM_AUTH);
  headers.set('accept-encoding', 'identity');
  headers.set('host', new URL(UPSTREAM).host);
  headers.set('x-forwarded-host', req.headers.get('host') ?? env.origin);
  headers.set('x-forwarded-proto', 'http');
  return headers;
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    const lower = key.toLowerCase();
    if (HOP_BY_HOP.has(lower)) continue;
    if (lower === 'content-length' || lower === 'content-encoding') continue;
    if (lower === 'set-cookie') continue;
    headers.set(key, value);
  }
  // Upstream may emit multiple Set-Cookie headers; preserve them all.
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return headers;
}

async function proxy(req: Request, env: EnvConfig, url: URL): Promise<Response> {
  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return new Response(
      'WebSocket upgrades are not proxied by the Phase 1 dashboard. Use the direct opencode client for terminals.\n',
      { status: 501, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const target = `${UPSTREAM}${url.pathname}${url.search}`;
  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    body = await req.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: req.method,
      headers: proxyHeaders(req, env),
      body,
      redirect: 'manual',
    });
  } catch (err) {
    console.error('[dashboard] proxy error', target, err);
    return new Response(`Bad gateway: ${(err as Error).message}\n`, {
      status: 502,
      headers: { 'content-type': 'text/plain; charset=utf-8' },
    });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders(upstream),
  });
}

/* -------------------------------------------------------------- dashboard */

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function truncate(value: string, max = 90): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function renderDashboard(states: EnvState[]): string {
  const tiles = states
    .map((state) => {
      const { env, session, source } = state;
      const title = session?.title?.trim() || (session ? session.id : 'No session');
      const badge =
        source === 'override'
          ? `<span class="badge badge-manual" title="Mapped from dashboard/sessions.json">manual</span>`
          : source === 'auto'
            ? `<span class="badge badge-auto" title="Discovered from the opencode session list">auto</span>`
            : `<span class="badge badge-none">no session</span>`;

      const header = `
        <header class="tile-head">
          <span class="env">${escapeHtml(env.name)}</span>
          ${badge}
          <span class="title" title="${escapeHtml(title)}">${escapeHtml(truncate(title))}</span>
          <span class="spacer"></span>
          <a class="icon-btn" href="${escapeHtml(env.origin)}/" target="_blank" rel="noopener" title="Open this environment in a new tab" aria-label="Open in new tab">↗</a>
          <button class="icon-btn" type="button" data-action="refresh" data-env="${env.n}" title="Refresh this tile" aria-label="Refresh tile">⟳</button>
          <button class="icon-btn" type="button" data-action="collapse" data-env="${env.n}" title="Collapse this tile" aria-label="Collapse tile">▾</button>
        </header>`;

      const body = state.deepLink
        ? `<iframe
             id="frame-${env.n}"
             title="${escapeHtml(env.name)} opencode session"
             src="${escapeHtml(state.deepLink)}"
             loading="eager"
             allow="clipboard-read; clipboard-write; fullscreen"
           ></iframe>`
        : `<div class="placeholder" id="placeholder-${env.n}">
             <div class="placeholder-icon">⌘</div>
             <p><strong>No agent session yet for ${escapeHtml(env.name)}.</strong></p>
             <p>Open an opencode session in <code>.worktrees/${escapeHtml(env.name)}</code>, then Refresh.</p>
             <div class="placeholder-actions">
               <button class="btn" type="button" data-action="refresh" data-env="${env.n}">Refresh</button>
               <a class="btn btn-ghost" href="${escapeHtml(env.origin)}/" target="_blank" rel="noopener">Open client</a>
             </div>
             <p class="hint">Directory: <code>${escapeHtml(env.directory)}</code></p>
           </div>`;

      return `<section class="tile" id="tile-${env.n}" data-env="${env.n}">
        ${header}
        <div class="tile-body">${body}</div>
      </section>`;
    })
    .join('\n');

  const webLinks = ENVS.map(
    (env) =>
      `<a href="${env.webUrl}" target="_blank" rel="noopener">${env.name} <span>${3009 + env.n}</span></a>`,
  ).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>StudiQ QA Dashboard</title>
<style>
  :root {
    color-scheme: dark;
    --bg: #080808;
    --panel: #111113;
    --panel-2: #17171a;
    --border: #2a2a2e;
    --border-soft: #212125;
    --text: #e7e7ea;
    --muted: #8b8b93;
    --accent: #8ab4ff;
    --ok: #54d18a;
    --warn: #f0b34d;
    --err: #ff7a7a;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    background: var(--bg);
    color: var(--text);
    font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    overflow: hidden;
  }
  .app { display: flex; flex-direction: column; height: 100dvh; }

  .topbar {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 18px;
    height: 50px;
    padding: 0 14px;
    background: linear-gradient(180deg, #101012, #0b0b0d);
    border-bottom: 1px solid var(--border);
  }
  .brand { display: flex; align-items: baseline; gap: 9px; white-space: nowrap; }
  .brand strong { font-size: 14px; letter-spacing: .2px; }
  .brand span { color: var(--muted); font-size: 11px; }
  .links { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
  .links a {
    color: var(--text);
    text-decoration: none;
    border: 1px solid var(--border);
    background: var(--panel);
    border-radius: 999px;
    padding: 3px 9px;
    font-size: 11px;
    display: inline-flex;
    gap: 6px;
    align-items: center;
  }
  .links a:hover { border-color: #3d3d44; background: var(--panel-2); }
  .links a span { color: var(--muted); font-variant-numeric: tabular-nums; }
  .topbar .spacer { flex: 1; }
  .topbar .meta { color: var(--muted); font-size: 11px; white-space: nowrap; }

  .btn, .icon-btn {
    font: inherit;
    color: var(--text);
    background: var(--panel-2);
    border: 1px solid var(--border);
    border-radius: 7px;
    cursor: pointer;
    transition: background .12s, border-color .12s, transform .12s;
  }
  .btn { padding: 5px 12px; font-size: 12px; }
  .btn:hover, .icon-btn:hover { background: #24242a; border-color: #3d3d44; }
  .btn:active, .icon-btn:active { transform: translateY(1px); }
  .btn-ghost { background: transparent; }
  .icon-btn {
    width: 26px; height: 26px;
    display: inline-flex; align-items: center; justify-content: center;
    text-decoration: none; line-height: 1; font-size: 14px;
  }
  .icon-btn.refreshing { animation: spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .grid {
    flex: 1 1 auto;
    min-height: 0;
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 9px;
    padding: 9px;
  }
  .tile {
    min-width: 0; min-height: 0;
    display: flex; flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 10px;
    overflow: hidden;
    box-shadow: 0 10px 30px rgba(0,0,0,.28);
  }
  .tile-head {
    flex: 0 0 auto;
    display: flex; align-items: center; gap: 7px;
    height: 36px;
    padding: 0 7px 0 10px;
    background: linear-gradient(180deg, #17171a, #121214);
    border-bottom: 1px solid var(--border-soft);
    min-width: 0;
  }
  .env { font-weight: 650; font-size: 12px; letter-spacing: .3px; white-space: nowrap; }
  .title {
    color: var(--muted);
    font-size: 11.5px;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    min-width: 0;
  }
  .spacer { flex: 1; }
  .badge {
    flex: 0 0 auto;
    font-size: 9.5px; text-transform: uppercase; letter-spacing: .6px;
    border-radius: 999px; padding: 1px 6px; border: 1px solid var(--border);
    color: var(--muted); background: #101012;
  }
  .badge-auto { color: var(--ok); border-color: #24523a; background: #0d1a13; }
  .badge-manual { color: var(--warn); border-color: #554221; background: #1c160c; }
  .badge-none { color: var(--err); border-color: #572a2a; background: #1a0f0f; }

  .tile-body { position: relative; flex: 1 1 auto; min-height: 0; background: #0b0b0d; }
  .tile iframe { display: block; width: 100%; height: 100%; border: 0; background: #0b0b0d; }
  .tile.collapsed .tile-body { display: none; }
  .tile.collapsed .tile-head { border-bottom: 0; }
  .tile.collapsed .icon-btn[data-action="collapse"] { transform: rotate(-90deg); }

  .placeholder {
    height: 100%;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; padding: 22px; text-align: center; color: var(--muted);
  }
  .placeholder p { margin: 0; max-width: 460px; }
  .placeholder strong { color: var(--text); font-weight: 600; }
  .placeholder code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px; color: #c9c9d1; background: #17171a;
    border: 1px solid var(--border-soft); border-radius: 5px; padding: 1px 5px;
  }
  .placeholder-icon {
    width: 42px; height: 42px; border-radius: 12px;
    display: grid; place-items: center;
    color: var(--muted); font-size: 18px;
    border: 1px dashed var(--border); background: #101012;
    margin-bottom: 2px;
  }
  .placeholder-actions { display: flex; gap: 8px; margin-top: 6px; }
  .hint { font-size: 10.5px; opacity: .7; margin-top: 6px !important; }

  .toast {
    position: fixed; left: 50%; bottom: 18px; transform: translate(-50%, 20px);
    background: #1c1c20; border: 1px solid var(--border); color: var(--text);
    padding: 7px 14px; border-radius: 999px; font-size: 12px;
    opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s;
    box-shadow: 0 8px 28px rgba(0,0,0,.5);
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  @media (max-width: 900px) {
    body { overflow: auto; }
    .app { height: auto; min-height: 100dvh; }
    .grid { grid-template-columns: 1fr; grid-template-rows: none; }
    .tile { height: 68vh; }
    .links { display: none; }
  }
</style>
</head>
<body>
<div class="app">
  <div class="topbar">
    <div class="brand"><strong>QA Dashboard</strong><span>StudiQ · 4 isolated environments</span></div>
    <div class="links">${webLinks}</div>
    <div class="spacer"></div>
    <div class="meta" id="updated">sessions refreshed just now</div>
    <button class="btn" type="button" id="refresh-all">⟳ Refresh all</button>
  </div>
  <main class="grid">
${tiles}
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
  const toast = (msg) => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  };

  async function refreshMapping() {
    try {
      await fetch('/api/dashboard/refresh', { method: 'POST', cache: 'no-store' });
    } catch (err) {
      console.error(err);
    }
    location.reload();
  }

  document.getElementById('refresh-all').addEventListener('click', refreshMapping);

  document.addEventListener('click', (event) => {
    const target = event.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const n = target.dataset.env;
    const tile = document.getElementById('tile-' + n);

    if (action === 'refresh') {
      target.classList.add('refreshing');
      if (tile?.querySelector('iframe')) {
        refreshMapping();
      } else {
        refreshMapping();
      }
    }

    if (action === 'collapse') {
      tile?.classList.toggle('collapsed');
      const collapsed = tile?.classList.contains('collapsed');
      target.textContent = collapsed ? '▸' : '▾';
      target.title = collapsed ? 'Expand this tile' : 'Collapse this tile';
    }
  });

  // Keep the mapping fresh without touching already-loaded iframes.
  let lastSignature = '';
  setInterval(async () => {
    try {
      const res = await fetch('/api/dashboard/state', { cache: 'no-store' });
      if (!res.ok) return;
      const state = await res.json();
      const signature = state.envs.map((e) => (e.session?.id ?? '-')).join('|');
      if (lastSignature && signature !== lastSignature) {
        toast('Session mapping changed — reloading');
        setTimeout(() => location.reload(), 400);
      }
      lastSignature = signature;
      document.getElementById('updated').textContent =
        'sessions refreshed ' + new Date().toLocaleTimeString();
    } catch {}
  }, 15000);
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------------ server */

const server = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  development: false,
  idleTimeout: 0, // never time out long-lived SSE streams
  async fetch(req) {
    const url = new URL(req.url);

    if (url.pathname === '/healthz') {
      return Response.json({ ok: true, pid: process.pid, envs: ENVS.length });
    }

    const env = envFromHost(req.headers.get('host'));
    if (env) {
      // Bare tile root: deep-link to the env's newest session.
      if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
        const states = await loadStates();
        const state = states.find((s) => s.env.n === env.n);
        if (state?.deepLink) {
          return new Response(null, {
            status: 302,
            headers: { location: state.deepLink, 'cache-control': 'no-store' },
          });
        }
        // No session yet: let the SPA home render (still proxied/auth'd).
      }
      return proxy(req, env, url);
    }

    // Dashboard host.
    if (req.method === 'POST' && url.pathname === '/api/dashboard/refresh') {
      cache = null;
      const states = await loadStates(true);
      return Response.json({ ok: true, states: states.map(publicState) });
    }

    if (req.method === 'GET' && url.pathname === '/api/dashboard/state') {
      const states = await loadStates();
      return Response.json(
        { envs: states.map(publicState) },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      const states = await loadStates();
      return new Response(renderDashboard(states), {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-store',
        },
      });
    }

    if (req.method === 'GET' && url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    return new Response('Not found\n', { status: 404 });
  },
});

function publicState(state: EnvState) {
  return {
    name: state.env.name,
    origin: state.env.origin,
    directory: state.env.directory,
    webUrl: state.env.webUrl,
    deepLink: state.deepLink,
    source: state.source,
    session: state.session
      ? {
          id: state.session.id,
          title: state.session.title ?? null,
          updated: state.session.time?.updated ?? state.session.time?.created ?? null,
        }
      : null,
  };
}

console.log(
  `[dashboard] listening on http://${HOSTNAME}:${PORT} (pid ${process.pid}); upstream ${UPSTREAM}`,
);
for (const env of ENVS) {
  console.log(`[dashboard] ${env.name}: ${env.origin}/ → ${env.directory}`);
}
