import { AsyncLocalStorage } from 'async_hooks';

export const conversationStorage = new AsyncLocalStorage<{ conversationId: string }>();
