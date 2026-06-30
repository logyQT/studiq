import { AsyncLocalStorage } from 'node:async_hooks';

export const conversationStorage = new AsyncLocalStorage<{ conversationId: string }>();
