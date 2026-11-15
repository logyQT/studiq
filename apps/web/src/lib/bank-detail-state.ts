import { ApiError } from '@/lib/api';

type BankDetailState = 'loading' | 'not-found' | 'error' | 'ready';

interface BankDetailQuery {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  hasData: boolean;
}

/**
 * What the bank detail screen may render.
 *
 * A rejected request is not a missing bank: only a 404 means the id is unknown or belongs to
 * another organisation. Everything else (403, 5xx, offline) keeps the retry state, otherwise the
 * screen would offer the authoring UI for a bank that exists but could not be read. Data wins over
 * a failed background refetch so a transient error does not replace the bank the user is editing.
 */
export function bankDetailState(query: BankDetailQuery): BankDetailState {
  if (query.hasData) return 'ready';
  if (query.isLoading) return 'loading';
  if (query.isError) {
    return query.error instanceof ApiError && query.error.status === 404 ? 'not-found' : 'error';
  }
  return 'not-found';
}
