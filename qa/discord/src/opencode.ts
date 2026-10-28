export interface SessionSummary {
  id: string;
  title: string;
  directory: string;
  updated: number;
}

export interface ContentPart {
  type: string;
  text?: string;
  name?: string;
  state?: unknown;
}

export interface AssistantMessage {
  id: string;
  type: string;
  content: ContentPart[];
  time?: { created?: number; completed?: number };
}

export class OpencodeError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'OpencodeError';
  }
}

export class OpencodeClient {
  private readonly auth: string;

  constructor(
    private readonly baseUrl: string,
    user: string,
    password: string,
  ) {
    this.auth = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  }

  private async request<T>(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.auth,
        'Content-Type': 'application/json',
        'User-Agent': 'studiq-qa-discord/0.1',
        ...(init.headers ?? {}),
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new OpencodeError(
        `${init.method ?? 'GET'} ${path} -> ${res.status} ${body.slice(0, 300)}`,
        res.status,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async listSessions(directory: string, limit = 10): Promise<SessionSummary[]> {
    const q = `limit=${limit}&order=desc&directory=${encodeURIComponent(directory)}`;
    const body = await this.request<{ data?: Array<Record<string, unknown>> }>(`/api/session?${q}`);
    return (body.data ?? []).map((raw) => {
      const location = raw.location as { directory?: string } | undefined;
      const time = raw.time as { created?: number; updated?: number } | undefined;
      return {
        id: String(raw.id ?? ''),
        title: String(raw.title ?? ''),
        directory: String(location?.directory ?? directory),
        updated: Number(time?.updated ?? time?.created ?? 0),
      };
    });
  }

  /** sessionID -> "running" entries for every busy session. */
  async activeSessions(): Promise<Set<string>> {
    const body = await this.request<{ data?: Record<string, { type?: string }> }>(
      '/api/session/active',
    );
    return new Set(Object.keys(body.data ?? {}));
  }

  async messages(sessionId: string, limit = 50, type = 'assistant'): Promise<AssistantMessage[]> {
    const q = `limit=${limit}&order=desc&type=${type}`;
    const body = await this.request<{ data?: AssistantMessage[] }>(
      `/api/session/${encodeURIComponent(sessionId)}/message?${q}`,
    );
    return body.data ?? [];
  }

  async prompt(sessionId: string, text: string, delivery?: 'queue' | 'steer'): Promise<void> {
    const payload: Record<string, unknown> = { text };
    if (delivery) payload.delivery = delivery;
    await this.request(
      `/api/session/${encodeURIComponent(sessionId)}/prompt`,
      { method: 'POST', body: JSON.stringify(payload) },
      30_000,
    );
  }

  /** Fork a session (the `/btw` primitive): a copy that can answer without touching the parent. */
  async fork(sessionId: string): Promise<string> {
    const body = await this.request<{ data?: { id?: string }; id?: string }>(
      `/api/session/${encodeURIComponent(sessionId)}/fork`,
      { method: 'POST', body: '{}' },
      30_000,
    );
    const id = body.data?.id ?? body.id;
    if (!id) throw new OpencodeError('fork returned no session id');
    return String(id);
  }

  async remove(sessionId: string): Promise<void> {
    await this.request(
      `/api/session/${encodeURIComponent(sessionId)}`,
      { method: 'DELETE' },
      15_000,
    );
  }

  async createSession(input: {
    title: string;
    directory: string;
    model?: { providerID: string; id: string; variant?: string };
  }): Promise<SessionSummary> {
    const body = await this.request<Record<string, unknown>>(
      '/api/session',
      {
        method: 'POST',
        body: JSON.stringify({
          title: input.title,
          location: { directory: input.directory },
          ...(input.model ? { model: input.model } : {}),
        }),
      },
      30_000,
    );
    const raw = (body.data ?? body) as Record<string, unknown>;
    const time = raw.time as { created?: number; updated?: number } | undefined;
    return {
      id: String(raw.id ?? ''),
      title: String(raw.title ?? input.title),
      directory: input.directory,
      updated: Number(time?.updated ?? time?.created ?? Date.now()),
    };
  }

  async interrupt(sessionId: string): Promise<void> {
    await this.request(
      `/api/session/${encodeURIComponent(sessionId)}/interrupt`,
      { method: 'POST', body: '{}' },
      10_000,
    );
  }

  /** Current session for a slot: an active one if any, else the newest. */
  async resolveSession(directory: string): Promise<SessionSummary | null> {
    const [sessions, active] = await Promise.all([
      this.listSessions(directory, 10),
      this.activeSessions().catch(() => new Set<string>()),
    ]);
    if (sessions.length === 0) return null;
    return sessions.find((s) => active.has(s.id)) ?? sessions[0] ?? null;
  }
}
