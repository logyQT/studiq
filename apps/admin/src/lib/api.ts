const BASE_URL = '/api/v1';

/**
 * Browser helper for the admin API.
 *
 * In PEM mode (`ADMIN_PEM_KEYS` non-empty) the browser cannot sign requests, so
 * these calls are rejected by `apps/admin/src/proxy.ts`. That is a known
 * limitation of the env keyring; the DB-backed token system
 * (`docs/decisions/0007-admin-api-auth.md`) is what makes the panel usable in
 * production. Requests from ops/CI are signed with `scripts/admin-sign.ts`.
 */

/**
 * Error thrown by the admin API helpers. `message` stays the app error code
 * (e.g. `CONFLICT`, `NOT_FOUND`, `ERROR_UNAUTHORIZED`) so existing
 * `error.message === 'CODE'` checks keep working; `status` carries the HTTP
 * status so retry policy and error UI can tell 4xx from 5xx.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status: number) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Raw admin API call. The response body is unvalidated JSON; the typed helpers
 * below hand it to the caller as the type that caller asked for, which is the
 * one trusted (schema-less) boundary in the admin app.
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // A proxy 401/403 or a non-JSON 5xx page must still surface as an ApiError
  // with the real status, not as a JSON parse failure.
  if (!res.ok) {
    const json: unknown = await res.json().catch(() => ({}));
    const code = isRecord(json) && typeof json.error === 'string' ? json.error : undefined;
    throw new ApiError(code || `${method} ${url} failed`, res.status);
  }

  const json: unknown = await res.json().catch(() => ({}));
  const data = isRecord(json) ? json.data : undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- unvalidated `{ data }` envelope, typed by the caller
  return data as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, body);
}

export function apiPut<T>(path: string, body: unknown): Promise<T> {
  return request<T>('PUT', path, body);
}

export function apiDelete<T>(path: string): Promise<T> {
  return request<T>('DELETE', path);
}
