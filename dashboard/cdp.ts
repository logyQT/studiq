/**
 * Minimal Chrome DevTools Protocol client on top of Bun's WebSocket.
 *
 * One object = one CDP websocket (normally a single page target). Events are
 * exposed through `on()`; commands through `send()`. Also contains the small
 * HTTP helpers for Chrome's /json endpoints.
 */

import { BROWSER_HEIGHT, BROWSER_WIDTH } from './config';

type Pending = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
};

export type CdpTarget = {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
};

export class CdpClient {
  private ws: WebSocket;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private handlers = new Map<string, Set<(params: any) => void>>();
  private closeHandlers = new Set<() => void>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.binaryType = 'arraybuffer';
    ws.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
    ws.onclose = () => this.handleClose('CDP websocket closed');
    ws.onerror = () => this.handleClose('CDP websocket error');
  }

  static connect(wsUrl: string, timeoutMs = 10_000): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ws = new WebSocket(wsUrl);
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try {
          ws.close();
        } catch {}
        reject(new Error(`CDP connect timeout after ${timeoutMs}ms: ${wsUrl}`));
      }, timeoutMs);

      ws.onopen = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      };
      ws.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`CDP websocket error: ${wsUrl}`));
      };
    });
  }

  get isClosed(): boolean {
    return this.closed || this.ws.readyState !== WebSocket.OPEN;
  }

  send<T = any>(method: string, params: Record<string, any> = {}, timeoutMs = 20_000): Promise<T> {
    if (this.isClosed) return Promise.reject(new Error('CDP connection is closed'));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP timeout: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.ws.send(JSON.stringify({ id, method, params }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  on(method: string, handler: (params: any) => void): () => void {
    let set = this.handlers.get(method);
    if (!set) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
  }

  /** Called when the underlying CDP websocket closes (browser down/restart). */
  onClose(handler: () => void): () => void {
    if (this.closed) {
      handler();
      return () => {};
    }
    this.closeHandlers.add(handler);
    return () => this.closeHandlers.delete(handler);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.ws.close();
    } catch {}
    this.rejectAll(new Error('CDP connection closed'));
    this.fireClose();
  }

  private handleMessage(raw: any): void {
    let msg: any;
    try {
      const text = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
      msg = JSON.parse(text);
    } catch {
      return;
    }

    if (typeof msg.id === 'number') {
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(`${msg.error.message ?? 'CDP error'} (${msg.error.code ?? '?'})`));
      } else {
        pending.resolve(msg.result ?? {});
      }
      return;
    }

    if (typeof msg.method === 'string') {
      const set = this.handlers.get(msg.method);
      if (!set) return;
      for (const handler of [...set]) {
        try {
          handler(msg.params ?? {});
        } catch (err) {
          console.error(`[cdp] handler for ${msg.method} failed`, err);
        }
      }
    }
  }

  private handleClose(reason: string): void {
    if (this.closed) return;
    this.closed = true;
    this.rejectAll(new Error(reason));
    this.fireClose();
  }

  private fireClose(): void {
    const handlers = [...this.closeHandlers];
    this.closeHandlers.clear();
    for (const handler of handlers) {
      try {
        handler();
      } catch {}
    }
  }

  private rejectAll(error: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function fetchJson<T = any>(
  url: string,
  init?: RequestInit,
  timeoutMs = 2500,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

export async function cdpVersion(
  port: number,
  timeoutMs = 1200,
): Promise<{ Browser: string; webSocketDebuggerUrl: string } | null> {
  try {
    return await fetchJson(`http://127.0.0.1:${port}/json/version`, undefined, timeoutMs);
  } catch {
    return null;
  }
}

export async function cdpUp(port: number, timeoutMs = 1200): Promise<boolean> {
  return (await cdpVersion(port, timeoutMs)) !== null;
}

export async function listTargets(port: number): Promise<CdpTarget[]> {
  const list = await fetchJson<CdpTarget[]>(`http://127.0.0.1:${port}/json/list`);
  return list.filter(
    (target) =>
      target.type === 'page' &&
      typeof target.webSocketDebuggerUrl === 'string' &&
      !target.url.startsWith('devtools://'),
  );
}

export async function newTarget(port: number, url = 'about:blank'): Promise<CdpTarget> {
  const encoded = encodeURIComponent(url);
  try {
    return await fetchJson<CdpTarget>(`http://127.0.0.1:${port}/json/new?${encoded}`, {
      method: 'PUT',
    });
  } catch {
    // Older Chrome builds only accept GET.
    return await fetchJson<CdpTarget>(`http://127.0.0.1:${port}/json/new?${encoded}`);
  }
}

export async function closeTarget(port: number, targetId: string): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`, {
      signal: controller.signal,
    });
    // Chrome answers with plain text ("Target is closing"), not JSON.
    await res.text();
    if (!res.ok) throw new Error(`close target ${targetId} -> HTTP ${res.status}`);
  } finally {
    clearTimeout(timer);
  }
}

function rankTarget(target: CdpTarget): number {
  if (/^https?:/i.test(target.url)) return 0;
  if (target.url === 'about:blank') return 1;
  if (target.url.startsWith('chrome://')) return 2;
  return 3;
}

export type ResolvePageOptions = {
  preferredId?: string;
  createUrl?: string;
};

/** Pick a page target, creating one when the browser has none. */
export async function resolvePageTarget(
  port: number,
  options: ResolvePageOptions = {},
): Promise<CdpTarget> {
  let targets = await listTargets(port);
  if (options.preferredId) {
    const preferred = targets.find((target) => target.id === options.preferredId);
    if (preferred) return preferred;
  }
  if (targets.length === 0) {
    await newTarget(port, options.createUrl ?? 'about:blank');
    targets = await listTargets(port);
  }
  if (targets.length === 0) throw new Error(`no page targets on CDP port ${port}`);
  targets.sort((a, b) => rankTarget(a) - rankTarget(b));
  return targets[0]!;
}

export async function applyViewport(
  cdp: CdpClient,
  width = BROWSER_WIDTH,
  height = BROWSER_HEIGHT,
): Promise<void> {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: false,
    screenWidth: width,
    screenHeight: height,
  });
  // Keep typing/keyboard input working while the window is not focused.
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
}

export async function evaluate<T = any>(
  cdp: CdpClient,
  expression: string,
  options: { awaitPromise?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const result = await cdp.send<any>(
    'Runtime.evaluate',
    {
      expression,
      returnByValue: true,
      awaitPromise: options.awaitPromise ?? true,
      userGesture: true,
      includeCommandLineAPI: true,
    },
    options.timeoutMs ?? 20_000,
  );
  if (result?.exceptionDetails) {
    const detail = result.exceptionDetails;
    const message =
      detail.exception?.description ??
      detail.text ??
      detail.exception?.value ??
      'evaluation failed';
    throw new Error(`evaluate failed: ${message}`);
  }
  return result?.result?.value as T;
}

export async function pageState(
  cdp: CdpClient,
): Promise<{ url: string; title: string; readyState: string }> {
  return evaluate(
    cdp,
    '({url: location.href, title: document.title, readyState: document.readyState})',
  );
}

export async function waitFor(
  cdp: CdpClient,
  predicate: string,
  timeoutMs = 10_000,
  intervalMs = 150,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = await evaluate(cdp, predicate, { timeoutMs: 5000 });
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  const suffix = lastError ? ` (last error: ${(lastError as Error).message})` : '';
  throw new Error(`waitFor timed out after ${timeoutMs}ms${suffix}`);
}

export async function waitForLoad(cdp: CdpClient, timeoutMs = 15_000): Promise<void> {
  try {
    await waitFor(cdp, "document.readyState === 'complete'", timeoutMs);
  } catch {
    // SPA navigations can leave readyState at interactive; not fatal.
  }
  // Give the first paint / client-side redirect a moment to settle.
  await new Promise((resolve) => setTimeout(resolve, 250));
}

/**
 * Run a navigation-triggering action and wait for the next main-frame load
 * event. This avoids the race where the *old* document is still complete when
 * we start polling immediately after Page.navigate.
 */
export async function waitForNavigation(
  cdp: CdpClient,
  action: () => Promise<any>,
  timeoutMs = 20_000,
): Promise<any> {
  let finish: () => void = () => {};
  const loaded = new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      off();
      clearTimeout(timer);
      resolve();
    };
    const off = cdp.on('Page.loadEventFired', done);
    const timer = setTimeout(done, timeoutMs);
    finish = done;
  });
  let result: any;
  try {
    result = await action();
  } catch (err) {
    finish();
    throw err;
  }
  await loaded;
  await new Promise((resolve) => setTimeout(resolve, 100));
  return result;
}

export async function navigateTo(cdp: CdpClient, url: string, timeoutMs = 20_000): Promise<any> {
  return waitForNavigation(cdp, () => cdp.send('Page.navigate', { url }), timeoutMs);
}

export async function connectToPage(
  port: number,
  options: ResolvePageOptions = {},
): Promise<{ cdp: CdpClient; target: CdpTarget }> {
  const target = await resolvePageTarget(port, options);
  const cdp = await CdpClient.connect(target.webSocketDebuggerUrl);
  await cdp.send('Page.enable').catch(() => {});
  await cdp.send('Runtime.enable').catch(() => {});
  await applyViewport(cdp);
  return { cdp, target };
}
