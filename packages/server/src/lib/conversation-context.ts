import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContext } from '@studiq/authz';

/**
 * Per-request context available to agent tools via AsyncLocalStorage — set
 * once in the route handler, read anywhere down the tool-call stack without
 * threading it through every function signature. requestContext carries the
 * same org/permission-scope data withAuth() builds for regular routes, so a
 * future tool that needs to touch the database has authorization context to
 * scope its queries by, instead of having to invent its own.
 */
export const conversationStorage = new AsyncLocalStorage<{
  conversationId: string;
  requestContext: RequestContext;
}>();
