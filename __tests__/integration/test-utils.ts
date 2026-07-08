import type { NextRequest } from 'next/server';

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
  Object.defineProperty(req, 'cookies', {
    value: mockCookies(cookies),
    writable: false,
  });
  Object.defineProperty(req, 'nextUrl', {
    value: new URL(req.url),
    writable: false,
  });
  Object.defineProperty(req, 'page', { value: {}, writable: false });
  return req as unknown as NextRequest;
}

export function createNextRequest(url: string, init?: RequestInit, cookies?: Record<string, string>): NextRequest {
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
