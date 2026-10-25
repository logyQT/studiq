export type ApiIssueTree = {
  errors?: string[];
  properties?: Record<string, ApiIssueTree | undefined>;
};

/**
 * Error thrown by the API helpers. `message` stays the app error code (e.g.
 * `UNPROCESSABLE_ENTITY`) so existing `err.message === 'CODE'` checks keep
 * working; `issues` carries the per-field validation tree (`issues` in the
 * response body) so callers can show the precise validation message.
 */
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly issues?: ApiIssueTree;

  constructor(code: string, status: number, issues?: ApiIssueTree) {
    super(code);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.issues = issues;
  }
}

/** First validation code for a top-level field, e.g. ('name') -> 'VALIDATION_NAME_TOO_SHORT'. */
export function getFieldErrorCode(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError)) return undefined;
  return error.issues?.properties?.[field]?.errors?.[0];
}

async function throwIfNotOk(res: Response, method: string, url: string): Promise<void> {
  if (res.ok) return;
  const json = (await res.json().catch(() => ({}))) as { error?: string; issues?: ApiIssueTree };
  throw new ApiError(json.error || `${method} ${url} failed`, res.status, json.issues);
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  await throwIfNotOk(res, 'GET', url);
  const json = await res.json();
  return json.data as T;
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res, 'POST', url);
  const json = await res.json();
  return json.data as T;
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res, 'PUT', url);
  const json = await res.json();
  return json.data as T;
}

export async function apiDelete(url: string): Promise<void> {
  const res = await fetch(url, { method: 'DELETE' });
  await throwIfNotOk(res, 'DELETE', url);
}

export async function apiUploadFile<T>(url: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(url, { method: 'POST', body: formData });
  await throwIfNotOk(res, 'POST', url);
  const json = await res.json();
  return json.data as T;
}
