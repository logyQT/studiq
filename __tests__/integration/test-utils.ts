import { NextRequest } from 'next/server';

/**
 * Creates a properly typed NextRequest for integration tests.
 * Route handlers expect NextRequest but tests use standard Request.
 */
export function createNextRequest(url: string, init?: RequestInit): NextRequest {
  return new Request(url, init) as unknown as NextRequest;
}

/**
 * Creates a NextRequest with path params for [id] routes.
 * Returns both the request and the params object ready to pass to the handler.
 */
export function createNextRequestWithParams<T extends Record<string, string>>(
  url: string,
  params: T,
  init?: RequestInit,
): { request: NextRequest; params: Promise<T> } {
  return {
    request: new Request(url, init) as unknown as NextRequest,
    params: Promise.resolve(params),
  };
}
