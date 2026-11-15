import type { Database } from '@studiq/server/types/database';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { NextRequest } from 'next/server';

/**
 * Service-role client typed against the generated schema.
 *
 * `createServiceClient()` (helpers.ts) returns an untyped `SupabaseClient`, so
 * every row a test reads through it is `any`. This is the same client (same
 * env vars, same session settings) with the schema generic applied, so rows
 * come back as their `Database['public']['Tables'][…]['Row']` type.
 */
export function createTypedServiceClient(): SupabaseClient<Database> {
  return createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}

/**
 * The element a test requires at `index`: a seeded fixture, or a response the
 * test has just created. A miss means the setup or the endpoint dropped a row,
 * so fail here with the name of the missing item instead of letting a later
 * `undefined` surface as a confusing TypeError.
 */
export function requiredAt<T>(items: readonly T[], index: number, what: string): T {
  const item = items[index];
  if (item === undefined) throw new Error(`expected ${what} at index ${index}`);
  return item;
}

/** The entry a test requires at `key` in a response keyed by id. */
export function requiredEntry<T>(record: Record<string, T>, key: string, what: string): T {
  const value = record[key];
  if (value === undefined) throw new Error(`expected ${what} for "${key}"`);
  return value;
}

function mockCookies(cookieMap?: Record<string, string>) {
  const entries = Object.entries(cookieMap ?? {});
  return {
    get: (name: string) => {
      const val = cookieMap?.[name];
      return val ? { name, value: val } : undefined;
    },
    getAll: () => entries.map(([name, value]) => ({ name, value })),
    has: (name: string) => name in (cookieMap ?? {}),
    set: () => {},
    delete: () => {},
    clear: () => {},
    [Symbol.iterator]: () => entries.map(([name, value]) => `${name}=${value}`)[Symbol.iterator](),
    size: entries.length,
  };
}

function toNextRequest(req: Request, cookies?: Record<string, string>): NextRequest {
  // Wrap the plain `Request` in a real `NextRequest` so the route handler sees
  // the real `nextUrl` implementation instead of a hand-rolled stand-in.
  const nextRequest = new NextRequest(req);
  Object.defineProperty(nextRequest, 'cookies', {
    value: mockCookies(cookies),
    writable: false,
  });
  return nextRequest;
}

export function createNextRequest(
  url: string,
  init?: RequestInit,
  cookies?: Record<string, string>,
): NextRequest {
  return toNextRequest(new Request(url, init), cookies);
}

export function createNextRequestWithParams<T extends Record<string, string>>(
  url: string,
  params: T,
  init?: RequestInit,
  cookies?: Record<string, string>,
): { request: NextRequest; params: Promise<T> } {
  return {
    request: toNextRequest(new Request(url, init), cookies),
    params: Promise.resolve(params),
  };
}
