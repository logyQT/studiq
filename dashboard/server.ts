/**
 * StudiQ QA Dashboard - Phase 2
 *
 * One Bun server on :5000 that does three things:
 *
 *   1. Dashboard host (localhost:5000, 127.0.0.1:5000, ...)
 *      -> 2x2 grid of live Chromium tiles (CDP screencast + input forwarding)
 *         with a collapsible opencode chat drawer per tile.
 *
 *   2. Tile hosts (qa-env-N.localhost:5000)
 *      -> reverse proxy to the local opencode server on 127.0.0.1:4096,
 *         injecting the Basic auth header server-side. The SPA therefore
 *         runs same-origin with its API and never shows an auth prompt.
 *
 *   3. /ws/browser/N
 *      -> WebSocket screencast/input bridge to the Chromium on port 922N.
 *
 * No dependencies beyond Bun itself.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { recordConsole, recordNetwork } from './browser-core';
import {
  activeTargetId,
  getBrowserRecord,
  listenerPid,
  pidAlive,
  setActiveTarget,
} from './browser-state';
import {
  applyViewport,
  CdpClient,
  cdpUp,
  connectToPage,
  listTargets,
  navigateTo,
  pageState,
  waitForLoad,
  waitForNavigation,
} from './cdp';
import {
  BROWSER_HEIGHT,
  BROWSER_WIDTH,
  DECISIONS_FILE,
  ENVS,
  type EnvConfig,
  envByN,
  HOSTNAME,
  MANAGER_TOOL,
  PORT,
  PUBLIC_DIR,
  SESSIONS_FILE,
  UPSTREAM,
  UPSTREAM_AUTH,
} from './config';

/* --------------------------------------------------------------- sessions */

type Session = {
  id: string;
  title?: string;
  location?: { directory?: string };
  time?: { created?: number; updated?: number };
};

type AgentState = {
  state: 'free' | 'busy' | 'decision';
  pending: number;
  active: boolean;
  lastActivity: number | null;
};

type EnvState = {
  env: EnvConfig;
  session: Session | null;
  source: 'auto' | 'override' | 'none';
  deepLink: string | null;
  agent: AgentState;
};

type Cache = { at: number; states: EnvState[] };

let cache: Cache | null = null;
const CACHE_MS = 10_000;

function readOverrides(): Record<string, string> {
  if (!existsSync(SESSIONS_FILE)) return {};
  try {
    const raw = JSON.parse(readFileSync(SESSIONS_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (typeof value === 'string' && value.length > 0) out[key] = value;
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
  if (!res.ok) throw new Error(`GET /api/session -> ${res.status}`);
  const body = (await res.json()) as { data?: Session[] } | Session[];
  return Array.isArray(body) ? body : (body.data ?? []);
}

async function fetchActive(): Promise<Record<string, { type?: string }>> {
  const res = await fetch(`${UPSTREAM}/api/session/active`, {
    headers: {
      authorization: UPSTREAM_AUTH,
      accept: 'application/json',
      'accept-encoding': 'identity',
    },
  });
  if (!res.ok) throw new Error(`GET /api/session/active -> ${res.status}`);
  const body = (await res.json()) as { data?: Record<string, { type?: string }> };
  return body.data ?? {};
}

let lastDecisionSync = 0;

/** Keep the decisions inbox fresh so the tile dot can show "waiting". */
function syncDecisions(): void {
  if (Date.now() - lastDecisionSync < 20_000) return;
  lastDecisionSync = Date.now();
  try {
    spawnSync('python3', [MANAGER_TOOL, 'decisions', 'sync'], {
      timeout: 20_000,
      stdio: 'ignore',
    });
  } catch (err) {
    console.error('[dashboard] decisions sync failed:', err);
  }
}

function pendingByEnv(): Map<number, number> {
  const counts = new Map<number, number>();
  try {
    if (!existsSync(DECISIONS_FILE)) return counts;
    const raw = JSON.parse(readFileSync(DECISIONS_FILE, 'utf8')) as {
      items?: Array<{ env?: number; status?: string }>;
    };
    for (const item of raw.items ?? []) {
      if (item?.status === 'pending' && typeof item.env === 'number') {
        counts.set(item.env, (counts.get(item.env) ?? 0) + 1);
      }
    }
  } catch (err) {
    console.error('[dashboard] decisions read failed:', err);
  }
  return counts;
}

function agentFor(
  env: EnvConfig,
  session: Session | null,
  active: Record<string, { type?: string }>,
  pending: Map<number, number>,
): AgentState {
  const isActive = session ? Boolean(active[session.id]) : false;
  const pendingCount = pending.get(env.n) ?? 0;
  const state = isActive ? 'busy' : pendingCount > 0 ? 'decision' : 'free';
  return {
    state,
    pending: pendingCount,
    active: isActive,
    lastActivity: session?.time?.updated ?? session?.time?.created ?? null,
  };
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
  syncDecisions();
  let sessions: Session[] = [];
  try {
    sessions = await fetchSessions();
  } catch (err) {
    console.error('[dashboard] session discovery failed:', err);
  }
  let active: Record<string, { type?: string }> = {};
  try {
    active = await fetchActive();
  } catch (err) {
    console.error('[dashboard] active session lookup failed:', err);
  }
  const pending = pendingByEnv();

  const byId = new Map(sessions.map((session) => [session.id, session]));
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
        agent: agentFor(env, session, active, pending),
      };
    }

    const owned = sessions.filter(
      (session) => normalizeDir(session.location?.directory) === env.directory,
    );
    const session = mostRecent(owned);
    return {
      env,
      session,
      source: session ? ('auto' as const) : ('none' as const),
      deepLink: session ? `${env.origin}/server/${env.serverKey}/session/${session.id}` : null,
      agent: agentFor(env, session, active, pending),
    };
  });

  cache = { at: Date.now(), states };
  return states;
}

function normalizeDir(dir: string | undefined): string {
  if (!dir) return '';
  return dir.length > 1 ? dir.replace(/\/+$/, '') : dir;
}

function envFromHost(hostHeader: string | null): EnvConfig | null {
  const host = (hostHeader ?? '').split(':')[0]!.toLowerCase();
  const match = /^qa-env-([1-4])\./.exec(host);
  if (!match) return null;
  return envByN(Number(match[1]));
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
  const cookies = upstream.headers.getSetCookie?.() ?? [];
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return headers;
}

async function proxy(req: Request, env: EnvConfig, url: URL): Promise<Response> {
  if (req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
    return new Response(
      "WebSocket upgrades to the opencode server are not proxied. The dashboard's own tiles use /ws/browser/N. Use the direct opencode client for terminals.\n",
      { status: 501, headers: { 'content-type': 'text/plain; charset=utf-8' } },
    );
  }

  const target = `${UPSTREAM}${url.pathname}${url.search}`;
  let body: ArrayBuffer | undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') body = await req.arrayBuffer();

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

function renderTile(state: EnvState): string {
  const { env, session, source, agent } = state;
  const title = session?.title?.trim() || (session ? session.id : 'No session');
  const badge =
    source === 'override'
      ? `<span class="badge badge-manual" title="Mapped from dashboard/sessions.json">manual</span>`
      : source === 'auto'
        ? `<span class="badge badge-auto" title="Discovered from the opencode session list">auto</span>`
        : `<span class="badge badge-none">no session</span>`;

  const chatBody = state.deepLink
    ? `<iframe
         class="chat-frame"
         data-chat-frame
         title="${escapeHtml(env.name)} opencode session"
         data-src="${escapeHtml(state.deepLink)}"
         loading="lazy"
         allow="clipboard-read; clipboard-write; fullscreen"
       ></iframe>`
    : `<div class="chat-placeholder">
         <div class="placeholder-icon">⌘</div>
         <p><strong>No agent session yet for ${escapeHtml(env.name)}.</strong></p>
         <p>Open an opencode session in <code>.worktrees/${escapeHtml(env.name)}</code>, then Refresh.</p>
         <button class="btn" type="button" data-action="refresh" data-env="${env.n}">Refresh</button>
         <p class="hint">Directory: <code>${escapeHtml(env.directory)}</code></p>
       </div>`;

  return `<section class="tile" id="tile-${env.n}" data-env="${env.n}">
    <header class="tile-head">
      <span class="dot ${agent.state}" data-dot data-env="${env.n}" title="Agent: ${agent.state}${agent.pending ? ` (${agent.pending} decision${agent.pending === 1 ? '' : 's'})` : ''}"></span>
      <span class="env">${escapeHtml(env.name)}</span>
      <span class="agent-state ${agent.state}" data-agent-state data-env="${env.n}">${agent.state === 'decision' ? `decision ${agent.pending}` : agent.state}</span>
      ${badge}
      <div class="nav">
        <button class="icon-btn" type="button" data-bnav="back" data-env="${env.n}" title="Back" aria-label="Back">‹</button>
        <button class="icon-btn" type="button" data-bnav="forward" data-env="${env.n}" title="Forward" aria-label="Forward">›</button>
        <button class="icon-btn" type="button" data-bnav="reload" data-env="${env.n}" title="Reload" aria-label="Reload">⟳</button>
      </div>
      <input class="urlbar" data-url data-env="${env.n}" spellcheck="false" autocomplete="off"
             aria-label="${escapeHtml(env.name)} URL" value="${escapeHtml(env.startUrl)}" />
      <button class="icon-btn chat-btn" type="button" data-chat data-env="${env.n}"
              title="Toggle agent chat" aria-label="Toggle agent chat" aria-pressed="false">💬</button>
      <a class="icon-btn" href="${escapeHtml(env.webUrl)}" target="_blank" rel="noopener"
         title="Open ${escapeHtml(env.name)} app in a new tab" aria-label="Open app in new tab">↗</a>
      <button class="icon-btn" type="button" data-action="collapse" data-env="${env.n}" title="Collapse this tile" aria-label="Collapse tile">▾</button>
    </header>
    <div class="tile-body">
      <div class="browser">
        <div class="stage">
          <img class="screen" data-screen data-env="${env.n}" alt="${escapeHtml(env.name)} live browser" />
          <div class="surface" data-surface data-env="${env.n}" tabindex="0"
               role="application" aria-label="${escapeHtml(env.name)} live browser input"></div>
          <div class="down" data-down data-env="${env.n}" hidden>
            <div class="down-spinner"></div>
            <div class="down-title">Browser down</div>
            <div class="down-sub">reconnecting…</div>
          </div>
        </div>
      </div>
      <aside class="drawer" data-drawer data-env="${env.n}" aria-hidden="true">
        <div class="drawer-head">
          <span class="drawer-title">Chat · ${escapeHtml(env.name)}</span>
          <span class="drawer-sub" title="${escapeHtml(title)}">${escapeHtml(truncate(title, 46))}</span>
          <span class="spacer"></span>
          <button class="icon-btn" type="button" data-chat-close data-env="${env.n}" title="Close chat" aria-label="Close chat">×</button>
        </div>
        <div class="drawer-body">${chatBody}</div>
      </aside>
    </div>
  </section>`;
}

function renderDashboard(states: EnvState[]): string {
  const tiles = states.map(renderTile).join('\n');
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
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#0b0b0d" />
<link rel="apple-touch-icon" href="/icon-192.png" />
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
    --focus: #5b8fd6;
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
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    gap: 16px;
    height: 48px;
    padding: 0 12px;
    background: linear-gradient(180deg, #101012, #0b0b0d);
    border-bottom: 1px solid var(--border);
    transform: translateY(-100%);
    transition: transform .16s ease;
  }
  .topbar.visible, .topbar:focus-within { transform: translateY(0); }
  .topbar-zone {
    position: fixed;
    top: 0; left: 0; right: 0;
    height: 32px;
    z-index: 59;
    pointer-events: none;
  }
  .topbar-zone::after {
    content: '';
    position: absolute;
    top: 0; left: 50%; transform: translateX(-50%);
    width: 64px; height: 3px;
    border-radius: 0 0 4px 4px;
    background: #3a3a40;
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
  .topbar .meta { color: var(--muted); font-size: 11px; white-space: nowrap; display: flex; gap: 10px; align-items: center; }
  .browser-pill {
    border: 1px solid var(--border); background: #101012; border-radius: 999px;
    padding: 2px 8px; font-size: 10.5px; color: var(--muted); white-space: nowrap;
  }
  .browser-pill b { color: var(--ok); font-weight: 600; }
  .browser-pill.partial b { color: var(--warn); }

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
    width: 25px; height: 25px; flex: 0 0 auto;
    display: inline-flex; align-items: center; justify-content: center;
    text-decoration: none; line-height: 1; font-size: 14px;
    padding: 0;
  }
  .icon-btn[disabled] { opacity: .35; cursor: default; }
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
  .tile.focused { border-color: var(--focus); box-shadow: 0 0 0 1px var(--focus), 0 10px 30px rgba(0,0,0,.32); }
  .tile-head {
    flex: 0 0 auto;
    display: flex; align-items: center; gap: 6px;
    height: 37px;
    padding: 0 6px 0 9px;
    background: linear-gradient(180deg, #17171a, #121214);
    border-bottom: 1px solid var(--border-soft);
    min-width: 0;
  }
  .dot {
    width: 8px; height: 8px; border-radius: 50%; flex: 0 0 auto;
    background: #666; transition: background .2s, box-shadow .2s;
  }
  .dot.free { background: var(--ok); box-shadow: 0 0 7px rgba(84,209,138,.75); }
  .dot.busy { background: var(--err); box-shadow: 0 0 7px rgba(255,122,122,.7); }
  .dot.decision { background: var(--warn); box-shadow: 0 0 7px rgba(240,179,77,.75); animation: pulse 1.4s ease-in-out infinite; }
  .dot.down, .dot.connecting { background: #666; }
  @keyframes pulse { 50% { opacity: .3; } }
  .env { font-weight: 650; font-size: 12px; letter-spacing: .3px; white-space: nowrap; }
  .agent-state {
    flex: 0 0 auto;
    font-size: 9px; text-transform: uppercase; letter-spacing: .6px;
    color: var(--muted); white-space: nowrap;
  }
  .agent-state.free { color: var(--ok); }
  .agent-state.busy { color: var(--err); }
  .agent-state.decision { color: var(--warn); }
  .badge {
    flex: 0 0 auto;
    font-size: 9px; text-transform: uppercase; letter-spacing: .6px;
    border-radius: 999px; padding: 1px 5px; border: 1px solid var(--border);
    color: var(--muted); background: #101012;
  }
  .badge-auto { color: var(--ok); border-color: #24523a; background: #0d1a13; }
  .badge-manual { color: var(--warn); border-color: #554221; background: #1c160c; }
  .badge-none { color: var(--err); border-color: #572a2a; background: #1a0f0f; }
  .nav { display: flex; gap: 2px; flex: 0 0 auto; }
  .nav .icon-btn { width: 23px; height: 23px; font-size: 15px; background: transparent; border-color: transparent; }
  .nav .icon-btn:hover { background: #24242a; border-color: var(--border); }
  .urlbar {
    flex: 1 1 auto; min-width: 40px;
    height: 24px; padding: 2px 7px;
    color: #cfd3da; background: #0b0b0d;
    border: 1px solid var(--border); border-radius: 6px;
    font: 11px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    outline: none;
  }
  .urlbar:focus { border-color: var(--focus); background: #0e1117; }
  .chat-btn { font-size: 12px; }
  .tile.chat-open .chat-btn { background: #1b2a40; border-color: #33517a; }

  .tile-body {
    flex: 1 1 auto; min-height: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) 0;
    transition: grid-template-columns .18s ease;
  }
  .tile.chat-open .tile-body { grid-template-columns: minmax(0, 1fr) min(420px, 52%); }
  .browser { position: relative; min-width: 0; background: #000; overflow: hidden; }
  .stage { position: absolute; inset: 0; background: #000; }
  .screen {
    position: absolute; inset: 0; width: 100%; height: 100%;
    object-fit: contain; display: block; pointer-events: none;
    background: #000;
  }
  .surface {
    position: absolute; inset: 0;
    outline: none; cursor: crosshair; touch-action: none;
    -webkit-user-select: none; user-select: none;
  }
  .tile.focused .surface { cursor: default; }
  .down {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 7px;
    background: rgba(8,8,8,.72); color: var(--text); text-align: center;
    backdrop-filter: blur(1px); z-index: 3;
  }
  .down[hidden] { display: none; }
  .down-spinner {
    width: 22px; height: 22px; border-radius: 50%;
    border: 2px solid #333; border-top-color: var(--warn);
    animation: spin .9s linear infinite;
  }
  .down-title { font-weight: 600; font-size: 12.5px; }
  .down-sub { color: var(--muted); font-size: 11px; }

  .drawer {
    min-width: 0; overflow: hidden;
    display: flex; flex-direction: column;
    border-left: 1px solid var(--border-soft);
    background: var(--panel);
    visibility: hidden;
  }
  .tile.chat-open .drawer { visibility: visible; }
  .drawer-head {
    flex: 0 0 auto; height: 33px;
    display: flex; align-items: center; gap: 6px;
    padding: 0 5px 0 9px;
    border-bottom: 1px solid var(--border-soft);
    background: #141417;
    min-width: 0;
  }
  .drawer-title { font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .drawer-sub {
    color: var(--muted); font-size: 10.5px; white-space: nowrap;
    overflow: hidden; text-overflow: ellipsis; min-width: 0;
  }
  .drawer-body { flex: 1 1 auto; min-height: 0; background: #0b0b0d; }
  .chat-frame { display: block; width: 100%; height: 100%; border: 0; background: #0b0b0d; }
  .chat-placeholder {
    height: 100%; display: flex; flex-direction: column; align-items: center;
    justify-content: center; gap: 8px; padding: 18px; text-align: center; color: var(--muted);
  }
  .chat-placeholder p { margin: 0; max-width: 320px; font-size: 12px; }
  .chat-placeholder strong { color: var(--text); font-weight: 600; }
  .chat-placeholder code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10.5px; color: #c9c9d1; background: #17171a;
    border: 1px solid var(--border-soft); border-radius: 5px; padding: 1px 5px;
  }
  .placeholder-icon {
    width: 38px; height: 38px; border-radius: 11px;
    display: grid; place-items: center; color: var(--muted); font-size: 16px;
    border: 1px dashed var(--border); background: #101012;
  }
  .hint { font-size: 10px; opacity: .7; }
  .spacer { flex: 1; }

  .tile.collapsed .tile-body { display: none; }
  .tile.collapsed .tile-head { border-bottom: 0; }
  .tile.collapsed .icon-btn[data-action="collapse"] { transform: rotate(-90deg); }

  .toast {
    position: fixed; left: 50%; bottom: 18px; transform: translate(-50%, 20px);
    background: #1c1c20; border: 1px solid var(--border); color: var(--text);
    padding: 7px 14px; border-radius: 999px; font-size: 12px;
    opacity: 0; pointer-events: none; transition: opacity .18s, transform .18s;
    box-shadow: 0 8px 28px rgba(0,0,0,.5); z-index: 20;
  }
  .toast.show { opacity: 1; transform: translate(-50%, 0); }

  @media (max-width: 1000px) {
    body { overflow: auto; }
    .app { height: auto; min-height: 100dvh; }
    .grid { grid-template-columns: 1fr; grid-template-rows: none; }
    .tile { height: 72vh; }
    .links { display: none; }
    .badge { display: none; }
  }
</style>
</head>
<body>
<div class="app">
  <div class="topbar-zone" id="topbar-zone" aria-hidden="true"></div>
  <div class="topbar">
    <div class="brand"><strong>QA Dashboard</strong><span>StudiQ · live environments</span></div>
    <div class="links">${webLinks}</div>
    <div class="spacer"></div>
    <div class="meta">
      <span class="browser-pill" id="browser-pill">browsers <b>…</b></span>
      <span id="updated">sessions refreshed just now</span>
    </div>
    <button class="btn" type="button" id="refresh-all">⟳ Refresh all</button>
  </div>
  <main class="grid">
${tiles}
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
(() => {
  "use strict";

  const BROWSER_W = ${BROWSER_WIDTH};
  const BROWSER_H = ${BROWSER_HEIGHT};
  const ASPECT = BROWSER_W / BROWSER_H;

  const toast = (msg) => {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(window.__toastTimer);
    window.__toastTimer = setTimeout(() => el.classList.remove('show'), 2000);
  };

  const tileEls = new Map();

  class LiveTile {
    constructor(n) {
      this.n = n;
      this.tile = document.getElementById('tile-' + n);
      this.img = this.tile.querySelector('[data-screen]');
      this.surface = this.tile.querySelector('[data-surface]');
      this.dot = this.tile.querySelector('[data-dot]');
      this.down = this.tile.querySelector('[data-down]');
      this.downSub = this.down?.querySelector('.down-sub');
      this.urlInput = this.tile.querySelector('[data-url]');
      this.ws = null;
      this.attempt = 0;
      this.timer = null;
      this.live = false;
      this.pendingMove = null;
      this.moveRaf = 0;
      this.lastDown = 0;
      this.lastPoint = null;
      this.lastState = '';
      this.bind();
      this.restoreChat();
      this.connect();
    }

    /* ---------------------------------------------------------------- ws */

    connect() {
      if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      let ws;
      try {
        ws = new WebSocket(proto + '//' + location.host + '/ws/browser/' + this.n);
      } catch (err) {
        this.scheduleReconnect();
        return;
      }
      ws.binaryType = 'arraybuffer';
      this.ws = ws;
      ws.onopen = () => {
        this.attempt = 0;
      };
      ws.onmessage = (event) => this.onMessage(event.data);
      ws.onerror = () => { try { ws.close(); } catch (_) {} };
      ws.onclose = () => {
        if (this.ws === ws) this.ws = null;
        this.live = false;
        this.setDown('reconnecting…');
        this.scheduleReconnect();
      };
    }

    scheduleReconnect() {
      clearTimeout(this.timer);
      const delay = Math.min(8000, Math.round(400 * Math.pow(1.7, this.attempt++)));
      this.timer = setTimeout(() => this.connect(), delay);
    }

    send(message) {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
      try {
        this.ws.send(JSON.stringify(message));
        return true;
      } catch (_) {
        return false;
      }
    }

    onMessage(data) {
      if (typeof data !== 'string') {
        this.onFrame(data);
        return;
      }
      let message;
      try { message = JSON.parse(data); } catch (_) { return; }
      if (!message || typeof message.type !== 'string') return;
      if (message.type === 'state') {
        this.applyState(message);
      } else if (message.type === 'ready') {
        this.setConnecting();
      } else if (message.type === 'error') {
        this.setDown('browser error');
        this.downSub.textContent = message.message || 'reconnecting…';
        toast('qa-env-' + this.n + ': ' + (message.message || 'browser error'));
      } else if (message.type === 'frame-meta') {
        // reserved
      }
    }

    onFrame(data) {
      let blob;
      try {
        blob = data instanceof Blob ? data : new Blob([data], { type: 'image/jpeg' });
      } catch (_) {
        return;
      }
      const previous = this.img.dataset.objurl;
      const url = URL.createObjectURL(blob);
      this.img.onload = () => {
        if (previous) URL.revokeObjectURL(previous);
        this.img.onload = null;
      };
      this.img.dataset.objurl = url;
      this.img.src = url;
      if (!this.live) {
        this.live = true;
        this.down.hidden = true;
      }
    }

    applyState(message) {
      const signature = (message.url || '') + '|' + (message.title || '');
      if (signature !== this.lastState) {
        this.lastState = signature;
        if (document.activeElement !== this.urlInput && message.url) {
          this.urlInput.value = message.url;
        }
        if (message.title) this.tile.title = 'qa-env-' + this.n + ' — ' + message.title;
      }
    }

    setConnecting() {
      if (this.live) return;
      this.down.hidden = false;
      this.down.querySelector('.down-title').textContent = 'Connecting to browser';
      this.downSub.textContent = 'qa-env-' + this.n + ' · port ' + (9220 + this.n);
    }

    setDown(sub) {
      this.down.hidden = false;
      this.down.querySelector('.down-title').textContent = 'Browser down';
      this.downSub.textContent = sub || 'reconnecting…';
    }

    applyAgent(agent) {
      if (!agent) return;
      const cls = agent.state === 'decision' ? 'decision' : agent.state;
      this.dot.className = 'dot ' + cls;
      this.dot.title = agent.state === 'busy'
        ? 'Agent working'
        : agent.state === 'decision'
          ? 'Waiting for a decision (' + agent.pending + ')'
          : 'Free';
      const label = this.tile.querySelector('[data-agent-state]');
      if (label) {
        label.textContent = agent.state === 'decision' ? 'decision ' + agent.pending : agent.state;
        label.className = 'agent-state ' + cls;
      }
    }

    /* ------------------------------------------------------------ input */

    mapPoint(event) {
      const rect = this.surface.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;
      let width = rect.width;
      let height = width / ASPECT;
      if (height > rect.height) {
        height = rect.height;
        width = height * ASPECT;
      }
      const left = rect.left + (rect.width - width) / 2;
      const top = rect.top + (rect.height - height) / 2;
      const x = ((event.clientX - left) / width) * BROWSER_W;
      const y = ((event.clientY - top) / height) * BROWSER_H;
      if (x < 0 || y < 0 || x > BROWSER_W || y > BROWSER_H) return null;
      return { x: Math.max(0, Math.min(BROWSER_W - 1, Math.round(x))), y: Math.max(0, Math.min(BROWSER_H - 1, Math.round(y))) };
    }

    buttonName(button) {
      return button === 2 ? 'right' : button === 1 ? 'middle' : 'left';
    }

    bind() {
      this.tile.addEventListener('pointerdown', () => {
        for (const [key, other] of tileEls) if (key !== this.n) other.tile.classList.remove('focused');
        this.tile.classList.add('focused');
      }, true);

      this.surface.addEventListener('focus', () => {
        this.tile.classList.add('focused');
        this.send({ type: 'focus' });
      });
      this.surface.addEventListener('blur', () => this.tile.classList.remove('focused'));

      this.surface.addEventListener('pointermove', (event) => {
        const point = this.mapPoint(event);
        if (!point) return;
        this.pendingMove = point;
        if (this.moveRaf) return;
        this.moveRaf = requestAnimationFrame(() => {
          this.moveRaf = 0;
          if (!this.pendingMove) return;
          const p = this.pendingMove;
          this.pendingMove = null;
          this.send({ type: 'mouse', action: 'move', x: p.x, y: p.y });
        });
      });

      this.surface.addEventListener('pointerdown', (event) => {
        const point = this.mapPoint(event);
        if (!point) return;
        event.preventDefault();
        this.surface.focus({ preventScroll: true });
        const now = performance.now();
        let clickCount = 1;
        if (this.lastPoint && now - this.lastDown < 450) {
          const dx = point.x - this.lastPoint.x;
          const dy = point.y - this.lastPoint.y;
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) clickCount = 2;
        }
        this.lastDown = now;
        this.lastPoint = point;
        try { this.surface.setPointerCapture(event.pointerId); } catch (_) {}
        this.send({
          type: 'mouse', action: 'down', x: point.x, y: point.y,
          button: this.buttonName(event.button), clickCount,
        });
      });

      const release = (event) => {
        const point = this.mapPoint(event);
        if (!point) return;
        event.preventDefault();
        this.send({
          type: 'mouse', action: 'up', x: point.x, y: point.y,
          button: this.buttonName(event.button),
        });
      };
      this.surface.addEventListener('pointerup', release);
      this.surface.addEventListener('pointercancel', release);

      this.surface.addEventListener('contextmenu', (event) => event.preventDefault());

      this.surface.addEventListener('wheel', (event) => {
        const point = this.mapPoint(event);
        if (!point) return;
        event.preventDefault();
        this.send({
          type: 'mouse', action: 'wheel', x: point.x, y: point.y,
          deltaX: Math.round(event.deltaX), deltaY: Math.round(event.deltaY),
        });
      }, { passive: false });

      this.surface.addEventListener('keydown', (event) => {
        const modifiers = (event.altKey ? 1 : 0) | (event.ctrlKey ? 2 : 0) | (event.metaKey ? 4 : 0) | (event.shiftKey ? 8 : 0);
        const printable = event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
        const text = event.key === 'Enter' ? '\\r' : (printable ? event.key : undefined);
        this.send({
          type: 'key', action: 'down', key: event.key, code: event.code,
          keyCode: event.keyCode, modifiers, text, repeat: event.repeat,
        });
        this.send({
          type: 'key', action: 'up', key: event.key, code: event.code,
          keyCode: event.keyCode, modifiers, repeat: event.repeat,
        });
        event.preventDefault();
        event.stopPropagation();
      });

      this.surface.addEventListener('paste', (event) => {
        const text = event.clipboardData && event.clipboardData.getData('text');
        if (!text) return;
        event.preventDefault();
        this.send({ type: 'text', text });
      });

      this.urlInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        event.stopPropagation();
        let value = this.urlInput.value.trim();
        if (!value) return;
        if (!/^[a-z]+:\\/\\//i.test(value) && !value.startsWith('about:')) value = 'http://' + value;
        this.send({ type: 'navigate', url: value });
        toast('qa-env-' + this.n + ' → ' + value);
      });
      this.urlInput.addEventListener('focus', () => this.urlInput.select());

      this.tile.querySelectorAll('[data-bnav]').forEach((button) => {
        button.addEventListener('click', () => {
          this.send({ type: 'nav', action: button.dataset.bnav });
        });
      });

      const chatButton = this.tile.querySelector('[data-chat]');
      chatButton.addEventListener('click', () => this.toggleChat());
      this.tile.querySelector('[data-chat-close]').addEventListener('click', () => this.setChat(false));
    }

    /* ------------------------------------------------------------- chat */

    chatKey() { return 'studiq.qa.chat.' + this.n; }

    restoreChat() {
      let open = false;
      try { open = localStorage.getItem(this.chatKey()) === '1'; } catch (_) {}
      if (open) this.setChat(true);
    }

    toggleChat() {
      const open = !this.tile.classList.contains('chat-open');
      this.setChat(open);
    }

    setChat(open) {
      this.tile.classList.toggle('chat-open', open);
      const drawer = this.tile.querySelector('[data-drawer]');
      const button = this.tile.querySelector('[data-chat]');
      drawer.setAttribute('aria-hidden', open ? 'false' : 'true');
      button.setAttribute('aria-pressed', open ? 'true' : 'false');
      try { localStorage.setItem(this.chatKey(), open ? '1' : '0'); } catch (_) {}
      if (open) {
        const frame = this.tile.querySelector('[data-chat-frame]');
        if (frame && !frame.src && frame.dataset.src) frame.src = frame.dataset.src;
        if (this.ws && this.ws.readyState === WebSocket.OPEN) this.send({ type: 'state' });
      }
    }
  }

  for (const n of [1, 2, 3, 4]) tileEls.set(n, new LiveTile(n));

  /* ------------------------------------------------------------- chrome */

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
      refreshMapping();
    }
    if (action === 'collapse') {
      tile?.classList.toggle('collapsed');
      const collapsed = tile?.classList.contains('collapsed');
      target.textContent = collapsed ? '▸' : '▾';
      target.title = collapsed ? 'Expand this tile' : 'Collapse this tile';
    }
  });

  async function pollBrowsers() {
    try {
      const res = await fetch('/api/browsers', { cache: 'no-store' });
      if (!res.ok) return;
      const body = await res.json();
      const up = body.browsers.filter((browser) => browser.up).length;
      const pill = document.getElementById('browser-pill');
      pill.innerHTML = 'browsers <b>' + up + '/4</b>';
      pill.classList.toggle('partial', up < 4);
    } catch (_) {}
  }

  let lastSignature = '';
  async function pollState() {
    try {
      const res = await fetch('/api/dashboard/state', { cache: 'no-store' });
      if (!res.ok) return;
      const state = await res.json();
      const signature = state.envs.map((env) => (env.session?.id ?? '-')).join('|');
      if (lastSignature && signature !== lastSignature) {
        toast('Session mapping changed — reloading');
        setTimeout(() => location.reload(), 500);
      }
      lastSignature = signature;
      for (const env of state.envs) {
        const n = Number(String(env.name).split('-').pop());
        tileEls.get(n)?.applyAgent?.(env.agent);
      }
      document.getElementById('updated').textContent = 'sessions refreshed ' + new Date().toLocaleTimeString();
    } catch (_) {}
  }

  const topbar = document.querySelector('.topbar');
  document.addEventListener('mousemove', (event) => {
    if (event.clientY <= 32) topbar.classList.add('visible');
  });
  document.addEventListener('pointerdown', (event) => {
    if (event.clientY <= 32) topbar.classList.add('visible');
  }, true);
  topbar.addEventListener('mouseleave', () => topbar.classList.remove('visible'));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') topbar.classList.remove('visible');
  });
  document.addEventListener('focusin', (event) => {
    if (topbar.contains(event.target)) topbar.classList.add('visible');
  });
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  pollBrowsers();
  pollState();
  setInterval(pollBrowsers, 10000);
  setInterval(pollState, 15000);
})();
</script>
</body>
</html>`;
}

/* ------------------------------------------------------------- browser ws */

type WsData = {
  n: number;
  cdp: CdpClient | null;
  targetId: string | null;
  closed: boolean;
  lastSent: number;
  stateSig: string;
  stateTimer: ReturnType<typeof setTimeout> | null;
  tabTimer: ReturnType<typeof setTimeout> | null;
  switching: boolean;
  queue: Promise<void>;
};

async function sendState(ws: any): Promise<void> {
  const cdp: CdpClient | null = ws.data.cdp;
  if (!cdp || cdp.isClosed) return;
  try {
    const state = await pageState(cdp);
    const signature = `${state.url}|${state.title}`;
    if (signature === ws.data.stateSig) return;
    ws.data.stateSig = signature;
    ws.send(JSON.stringify({ type: 'state', ...state }));
  } catch {}
}

/**
 * Attach this dashboard socket to the env's currently selected tab. Called on
 * open and again when the agent selects/opens/closes a tab via the CLI/MCP, so
 * the tile follows `tabs.json` instead of staying on a dead target.
 */
async function bindPage(ws: any, env: EnvConfig): Promise<void> {
  const wanted = activeTargetId(env.name);
  if (ws.data.cdp && !ws.data.cdp.isClosed) {
    if (!wanted || wanted === ws.data.targetId) return;
  }

  const old = ws.data.cdp;
  if (old) {
    ws.data.cdp = null;
    old.send('Page.stopScreencast').catch(() => {});
    old.close();
  }

  const connection = await connectToPage(env.cdpPort, {
    preferredId: wanted ?? undefined,
    createUrl: env.startUrl,
  });
  const cdp = connection.cdp;
  if (ws.data.closed) {
    cdp.close();
    return;
  }
  if (wanted !== connection.target.id) setActiveTarget(env.name, connection.target.id);
  ws.data.cdp = cdp;
  ws.data.targetId = connection.target.id;
  ws.data.stateSig = '';

  cdp.onClose(() => {
    // A reattach closes the old connection deliberately; only the currently
    // installed connection should tear down the dashboard socket.
    if (ws.data.cdp !== cdp) return;
    if (ws.data.closed) return;
    ws.data.closed = true;
    try {
      ws.close(1012, 'browser disconnected');
    } catch {}
  });

  await applyViewport(cdp, BROWSER_WIDTH, BROWSER_HEIGHT).catch(() => {});
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  await cdp.send('Network.enable', { maxTotalBufferSize: 20_000_000 }).catch(() => {});

  cdp.on('Page.screencastFrame', (params: any) => {
    const now = Date.now();
    // ~12 fps: decode only frames we forward, but ALWAYS ack so Chrome keeps
    // producing frames (it pauses the stream otherwise).
    if (ws.data.closed || ws.data.cdp !== cdp) return;
    if (now - ws.data.lastSent >= 1000 / 12) {
      ws.data.lastSent = now;
      try {
        const bytes = Buffer.from(String(params.data ?? ''), 'base64');
        ws.send(bytes);
      } catch {}
    }
    cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }).catch(() => {});
  });

  cdp.on('Page.frameNavigated', () => {
    setTimeout(() => void sendState(ws), 120);
  });
  cdp.on('Page.loadEventFired', () => {
    setTimeout(() => void sendState(ws), 200);
  });

  cdp.on('Network.responseReceived', (params: any) => {
    const response = params.response ?? {};
    const headers = response.headers ?? {};
    const lower: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) lower[key.toLowerCase()] = String(value);
    recordNetwork(env, {
      source: 'dashboard',
      url: response.url,
      status: response.status,
      type: params.type,
      mimeType: response.mimeType,
      traceId: lower['x-trace-id'] ?? null,
      location: lower['location'] ?? null,
    });
  });

  cdp.on('Runtime.consoleAPICalled', (params: any) => {
    const text = (params.args ?? [])
      .map((arg: any) =>
        arg.value !== undefined ? String(arg.value) : (arg.description ?? arg.type),
      )
      .join(' ');
    recordConsole(env, {
      source: 'dashboard',
      level: params.type,
      text,
      url: params.stackTrace?.callFrames?.[0]?.url ?? null,
    });
  });

  cdp.on('Runtime.exceptionThrown', (params: any) => {
    recordConsole(env, {
      source: 'dashboard',
      level: 'exception',
      text:
        params.exceptionDetails?.exception?.description ??
        params.exceptionDetails?.text ??
        'exception',
      url: params.exceptionDetails?.url ?? null,
    });
  });

  await cdp
    .send('Page.startScreencast', {
      format: 'jpeg',
      quality: 70,
      maxWidth: BROWSER_WIDTH,
      maxHeight: BROWSER_HEIGHT,
      everyNthFrame: 1,
    })
    .catch((err) => {
      ws.send(
        JSON.stringify({ type: 'error', message: `screencast failed: ${(err as Error).message}` }),
      );
    });

  if (ws.data.closed) return;
  ws.send(JSON.stringify({ type: 'ready', env: env.name }));
  await sendState(ws);
}

async function attachBrowser(ws: any): Promise<void> {
  const env = envByN(ws.data.n);
  if (!env) {
    ws.close(1008, 'unknown env');
    return;
  }

  const record = getBrowserRecord(env.name);
  if (!record || !(await cdpUp(env.cdpPort, 900))) {
    ws.send(
      JSON.stringify({
        type: 'error',
        message: `${env.name} browser is not running (CDP ${env.cdpUrl})`,
      }),
    );
    ws.close(1013, 'browser down');
    return;
  }

  try {
    await bindPage(ws, env);
  } catch (err) {
    ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
    ws.close(1013, 'browser connect failed');
    return;
  }

  if (ws.data.closed) return;

  const pollState = async () => {
    if (ws.data.closed || !ws.data.cdp) return;
    await sendState(ws);
    ws.data.stateTimer = setTimeout(pollState, 2500);
  };
  ws.data.stateTimer = setTimeout(pollState, 2500);

  const pollTabs = async () => {
    if (ws.data.closed) return;
    if (!ws.data.switching) {
      const wanted = activeTargetId(env.name);
      if (wanted && wanted !== ws.data.targetId) {
        ws.data.switching = true;
        try {
          await bindPage(ws, env);
        } catch (err) {
          try {
            ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
          } catch {}
          try {
            ws.close(1012, 'tab switch failed');
          } catch {}
          return;
        } finally {
          ws.data.switching = false;
        }
      }
    }
    if (!ws.data.closed) ws.data.tabTimer = setTimeout(pollTabs, 1000);
  };
  ws.data.tabTimer = setTimeout(pollTabs, 1000);
}

function detachBrowser(ws: any): void {
  ws.data.closed = true;
  if (ws.data.stateTimer) clearTimeout(ws.data.stateTimer);
  ws.data.stateTimer = null;
  if (ws.data.tabTimer) clearTimeout(ws.data.tabTimer);
  ws.data.tabTimer = null;
  const cdp: CdpClient | null = ws.data.cdp;
  ws.data.cdp = null;
  if (cdp) {
    cdp.send('Page.stopScreencast').catch(() => {});
    cdp.close();
  }
}

async function onClientMessage(ws: any, raw: any): Promise<void> {
  const cdp: CdpClient | null = ws.data.cdp;
  if (!cdp || cdp.isClosed) return;

  let text: string;
  try {
    text = typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8');
  } catch {
    return;
  }
  let message: any;
  try {
    message = JSON.parse(text);
  } catch {
    return;
  }
  if (!message || typeof message.type !== 'string') return;

  try {
    switch (message.type) {
      case 'ping':
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      case 'focus':
        await cdp.send('Page.bringToFront').catch(() => {});
        await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
        return;
      case 'state':
        await sendState(ws);
        return;
      case 'mouse': {
        const x = clampInt(message.x, 0, BROWSER_WIDTH - 1, BROWSER_WIDTH / 2);
        const y = clampInt(message.y, 0, BROWSER_HEIGHT - 1, BROWSER_HEIGHT / 2);
        const button = ['left', 'right', 'middle'].includes(message.button)
          ? message.button
          : 'left';
        const buttons =
          message.action === 'down' ? (button === 'right' ? 2 : button === 'middle' ? 4 : 1) : 0;
        if (message.action === 'move') {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseMoved',
            x,
            y,
            button: 'none',
            buttons: 0,
          });
        } else if (message.action === 'down') {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mousePressed',
            x,
            y,
            button,
            buttons,
            clickCount: clampInt(message.clickCount, 1, 3, 1),
          });
        } else if (message.action === 'up') {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseReleased',
            x,
            y,
            button,
            buttons: 0,
            clickCount: clampInt(message.clickCount, 1, 3, 1),
          });
        } else if (message.action === 'wheel') {
          await cdp.send('Input.dispatchMouseEvent', {
            type: 'mouseWheel',
            x,
            y,
            deltaX: Number(message.deltaX) || 0,
            deltaY: Number(message.deltaY) || 0,
            modifiers: 0,
          });
        }
        return;
      }
      case 'key': {
        const action = message.action === 'up' ? 'keyUp' : 'keyDown';
        const key = String(message.key ?? '');
        const modifiers = Number(message.modifiers) || 0;
        const params: any = {
          type:
            action === 'keyUp'
              ? 'keyUp'
              : typeof message.text === 'string' && message.text.length > 0
                ? 'keyDown'
                : 'rawKeyDown',
          key,
          code: String(message.code ?? ''),
          windowsVirtualKeyCode: Number(message.keyCode) || 0,
          nativeVirtualKeyCode: Number(message.keyCode) || 0,
          modifiers,
          autoRepeat: Boolean(message.repeat),
        };
        if (params.type === 'keyDown' && typeof message.text === 'string') {
          params.text = message.text;
          params.unmodifiedText = message.text;
        }
        await cdp.send('Input.dispatchKeyEvent', params);
        return;
      }
      case 'text': {
        const value = String(message.text ?? '');
        if (value) await cdp.send('Input.insertText', { text: value });
        return;
      }
      case 'navigate': {
        let url = String(message.url ?? '').trim();
        if (!url) return;
        if (!/^[a-z]+:\/\//i.test(url) && !url.startsWith('about:') && !url.startsWith('data:')) {
          url = `http://${url}`;
        }
        await navigateTo(cdp, url, 20_000);
        await waitForLoad(cdp, 5000);
        ws.data.stateSig = '';
        await sendState(ws);
        return;
      }
      case 'nav': {
        const action = String(message.action ?? '');
        if (action === 'reload') {
          await waitForNavigation(
            cdp,
            () => cdp.send('Page.reload', { ignoreCache: false }),
            20_000,
          );
          await waitForLoad(cdp, 5000);
        } else if (action === 'back' || action === 'forward') {
          const history: any = await cdp.send('Page.getNavigationHistory');
          const index = history.currentIndex + (action === 'back' ? -1 : 1);
          const entry = history.entries?.[index];
          if (entry) {
            await waitForNavigation(
              cdp,
              () => cdp.send('Page.navigateToHistoryEntry', { entryId: entry.id }),
              20_000,
            );
            await waitForLoad(cdp, 5000);
          } else {
            ws.send(
              JSON.stringify({ type: 'error', message: `cannot go ${action}: no history entry` }),
            );
          }
        }
        ws.data.stateSig = '';
        await sendState(ws);
        return;
      }
      default:
        return;
    }
  } catch (err) {
    try {
      ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
    } catch {}
  }
}

function clampInt(value: any, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ---------------------------------------------------------------- health */

async function browserHealth(deep = false): Promise<any[]> {
  const results = await Promise.all(
    ENVS.map(async (env) => {
      const record = getBrowserRecord(env.name);
      const up = await cdpUp(env.cdpPort, 700);
      const entry: any = {
        name: env.name,
        cdp: env.cdpUrl,
        port: env.cdpPort,
        pid: record?.pid ?? listenerPid(env.cdpPort),
        pidAlive: record?.pid ? pidAlive(record.pid) : false,
        up,
        activeTargetId: activeTargetId(env.name),
        page: null,
        viewport: null,
      };
      if (!up) return entry;
      try {
        const targets = await listTargets(env.cdpPort);
        entry.targets = targets.length;
        const target =
          targets.find((item) => item.id === activeTargetId(env.name)) ??
          targets.find((item) => /^https?:/i.test(item.url)) ??
          targets[0];
        if (target) entry.page = { id: target.id, url: target.url, title: target.title };
        if (deep && target) {
          const { cdp } = await connectToPage(env.cdpPort, { preferredId: target.id });
          try {
            const value: any = await cdp.send('Runtime.evaluate', {
              expression:
                '({innerWidth, innerHeight, devicePixelRatio, url: location.href, title: document.title, readyState: document.readyState})',
              returnByValue: true,
            });
            entry.viewport = value?.result?.value ?? null;
          } finally {
            cdp.close();
          }
        }
      } catch (err) {
        entry.error = (err as Error).message;
      }
      return entry;
    }),
  );
  return results;
}

function publicState(state: EnvState) {
  return {
    name: state.env.name,
    origin: state.env.origin,
    directory: state.env.directory,
    webUrl: state.env.webUrl,
    adminUrl: state.env.adminUrl,
    deepLink: state.deepLink,
    source: state.source,
    agent: state.agent,
    session: state.session
      ? {
          id: state.session.id,
          title: state.session.title ?? null,
          updated: state.session.time?.updated ?? state.session.time?.created ?? null,
        }
      : null,
  };
}

const SERVICE_WORKER = `
const CACHE = 'studiq-qa-dashboard-v1';
const SHELL = ['/', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png'];
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/ws/') || url.pathname.startsWith('/server/')) return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy)).catch(() => {});
        return response;
      })
      .catch(() => caches.match(event.request).then((hit) => hit || caches.match('/')))
  );
});
`;

/* ---------------------------------------------------------------- server */

const server = Bun.serve<WsData>({
  hostname: HOSTNAME,
  port: PORT,
  development: false,
  idleTimeout: 0, // never time out long-lived SSE/WS streams
  async fetch(req, server) {
    const url = new URL(req.url);

    const wsMatch = /^\/ws\/browser\/([1-4])$/.exec(url.pathname);
    if (wsMatch) {
      const env = envByN(Number(wsMatch[1]));
      if (!env) return new Response('unknown env\n', { status: 404 });
      if (req.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
        return new Response('expected websocket upgrade\n', { status: 426 });
      }
      if (!(await cdpUp(env.cdpPort, 900))) {
        return new Response(`browser ${env.name} is down (${env.cdpUrl})\n`, {
          status: 503,
          headers: { 'content-type': 'text/plain; charset=utf-8' },
        });
      }
      const ok = server.upgrade(req, {
        data: {
          n: env.n,
          cdp: null,
          targetId: null,
          closed: false,
          lastSent: 0,
          stateSig: '',
          stateTimer: null,
          tabTimer: null,
          switching: false,
          queue: Promise.resolve(),
        },
      });
      if (ok) return undefined;
      return new Response('websocket upgrade failed\n', { status: 400 });
    }

    if (url.pathname === '/healthz') {
      const deep = url.searchParams.get('deep') === '1';
      const browsers = await browserHealth(deep);
      const browsersOk = browsers.every((browser) => browser.up);
      return Response.json(
        {
          ok: true,
          phase: 2,
          pid: process.pid,
          envs: ENVS.length,
          browsersOk,
          browsers,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    if (req.method === 'GET' && url.pathname === '/api/browsers') {
      return Response.json(
        { browsers: await browserHealth(url.searchParams.get('deep') === '1') },
        { headers: { 'cache-control': 'no-store' } },
      );
    }

    const env = envFromHost(req.headers.get('host'));
    if (env) {
      // Bare tile root: deep-link to the env's newest session.
      if (url.pathname === '/' && (req.method === 'GET' || req.method === 'HEAD')) {
        const states = await loadStates();
        const state = states.find((item) => item.env.n === env.n);
        if (state?.deepLink) {
          return new Response(null, {
            status: 302,
            headers: { location: state.deepLink, 'cache-control': 'no-store' },
          });
        }
      }
      return proxy(req, env, url);
    }

    if (url.pathname === '/manifest.webmanifest') {
      return Response.json(
        {
          name: 'StudiQ QA Dashboard',
          short_name: 'QA Dashboard',
          description: 'Four live StudiQ QA environments with agent status',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#080808',
          theme_color: '#0b0b0d',
          orientation: 'any',
          icons: [
            { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
            {
              src: '/icon-maskable-512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        {
          headers: {
            'content-type': 'application/manifest+json',
            'cache-control': 'public, max-age=3600',
          },
        },
      );
    }

    if (url.pathname === '/sw.js') {
      return new Response(SERVICE_WORKER, {
        headers: {
          'content-type': 'text/javascript; charset=utf-8',
          'cache-control': 'no-cache',
        },
      });
    }

    if (
      url.pathname === '/icon-192.png' ||
      url.pathname === '/icon-512.png' ||
      url.pathname === '/icon-maskable-512.png'
    ) {
      const file = Bun.file(join(PUBLIC_DIR, url.pathname.slice(1)));
      if (!(await file.exists())) return new Response('Not found\n', { status: 404 });
      return new Response(file, {
        headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' },
      });
    }

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
  websocket: {
    open(ws) {
      void attachBrowser(ws).catch((err) => {
        try {
          ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
        } catch {}
        try {
          ws.close(1011, 'attach failed');
        } catch {}
      });
    },
    message(ws, raw) {
      ws.data.queue = ws.data.queue
        .then(() => onClientMessage(ws, raw))
        .catch((err) => {
          try {
            ws.send(JSON.stringify({ type: 'error', message: (err as Error).message }));
          } catch {}
        });
    },
    close(ws) {
      detachBrowser(ws);
    },
    maxPayloadLength: 2 * 1024 * 1024,
    idleTimeout: 120,
  },
});

console.log(
  `[dashboard] phase 2 listening on http://${HOSTNAME}:${PORT} (pid ${process.pid}); upstream ${UPSTREAM}`,
);
for (const env of ENVS) {
  console.log(`[dashboard] ${env.name}: ${env.origin}/ -> ${env.directory}; browser ${env.cdpUrl}`);
}
