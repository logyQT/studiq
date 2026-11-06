import { isRecord } from '@/lib/unknown-value';

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

/**
 * All validation codes for a top-level field, e.g. a password can violate several
 * rules at once. Duplicates are removed so each rule is reported once.
 */
export function getFieldErrorCodes(error: unknown, field: string): string[] {
  if (!(error instanceof ApiError)) return [];
  return [...new Set(error.issues?.properties?.[field]?.errors ?? [])];
}

/** True when the request never reached the server (offline, DNS failure, blocked). */
export function isNetworkError(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'NETWORK_ERROR';
}

/** `fetch` that reports a transport failure as `ApiError('NETWORK_ERROR')` instead of a bare TypeError. */
async function request(...args: Parameters<typeof fetch>): Promise<Response> {
  try {
    return await fetch(...args);
  } catch (error) {
    if (error instanceof TypeError) throw new ApiError('NETWORK_ERROR', 0);
    throw error;
  }
}

/** Structural check for the validation tree the API puts in an error body. */
function isIssueTree(value: unknown): value is ApiIssueTree {
  if (!isRecord(value)) return false;

  if (value.errors !== undefined) {
    if (!Array.isArray(value.errors)) return false;
    for (const issue of value.errors) {
      if (typeof issue !== 'string') return false;
    }
  }

  if (value.properties !== undefined) {
    if (!isRecord(value.properties)) return false;
    for (const child of Object.values(value.properties)) {
      if (child !== undefined && !isIssueTree(child)) return false;
    }
  }

  return true;
}

/** `{ error, issues }` of a non-2xx body; absent or mistyped fields are dropped. */
function toApiErrorBody(value: unknown): { error?: string; issues?: ApiIssueTree } {
  const body: { error?: string; issues?: ApiIssueTree } = {};
  if (!isRecord(value)) return body;

  if (typeof value.error === 'string') body.error = value.error;
  if (isIssueTree(value.issues)) body.issues = value.issues;
  return body;
}

async function throwIfNotOk(res: Response, method: string, url: string): Promise<void> {
  if (res.ok) return;
  const raw: unknown = await res.json().catch(() => null);
  const body = toApiErrorBody(raw);
  throw new ApiError(body.error || `${method} ${url} failed`, res.status, body.issues);
}

/**
 * Decodes the `{ success: true, data }` envelope of a successful response.
 *
 * This is the single unchecked step of the client: the caller names the DTO the
 * endpoint returns (`apiGet<Flashcard[]>`), so the decoded body is handed back as
 * `T` here instead of at every call site. The status and the error envelope are
 * checked before this runs.
 */
async function decodeBody<T>(res: Response): Promise<T> {
  const raw: unknown = await res.json();
  const data: unknown = isRecord(raw) ? raw.data : undefined;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- `apiGet<T>`/`apiPost<T>`'s declared DTO is the boundary; a per-endpoint runtime schema is out of scope here
  return data as T;
}

export async function apiGet<T>(url: string): Promise<T> {
  const res = await request(url);
  await throwIfNotOk(res, 'GET', url);
  return decodeBody<T>(res);
}

export async function apiPost<T>(url: string, body: unknown): Promise<T> {
  const res = await request(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res, 'POST', url);
  return decodeBody<T>(res);
}

export async function apiPut<T>(url: string, body: unknown): Promise<T> {
  const res = await request(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  await throwIfNotOk(res, 'PUT', url);
  return decodeBody<T>(res);
}

export async function apiDelete(url: string): Promise<void> {
  const res = await request(url, { method: 'DELETE' });
  await throwIfNotOk(res, 'DELETE', url);
}

export async function apiUploadFile<T>(url: string, file: File): Promise<T> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await request(url, { method: 'POST', body: formData });
  await throwIfNotOk(res, 'POST', url);
  return decodeBody<T>(res);
}
