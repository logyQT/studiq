import { invalidateAfterWrite } from '@/lib/query-cache';
import {
  assignmentKeys,
  flashcardKeys,
  permissionKeys,
  questionKeys,
  questionReportKeys,
  quizKeys,
  studentAssignmentKeys,
  topicKeys,
} from '@/lib/query-keys';
import { InfiniteQueryObserver, QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const KEY = [...topicKeys.all, 'list'];

/**
 * A list endpoint whose responses are released by hand. Each request reads the rows when it
 * arrives, so a response held across a write answers with the rows from before it.
 */
function listServer() {
  const rows = ['old'];
  const held: Array<() => void> = [];
  return {
    rows,
    requests: () => held.length,
    get: (): Promise<string[]> => {
      const seen = [...rows];
      return new Promise((resolve) => held.push(() => resolve(seen)));
    },
    releaseAll: () => {
      for (const release of held) release();
    },
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('invalidateAfterWrite (#699)', () => {
  let client: QueryClient;
  let server: ReturnType<typeof listServer>;

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    server = listServer();
  });

  afterEach(() => {
    client.clear();
  });

  const listOptions = () => ({ queryKey: KEY, queryFn: server.get, staleTime: Infinity });

  /** Commits a row, invalidates, then lets every request answer, the oldest first. */
  async function writeThenAnswer(): Promise<void> {
    server.rows.push('new');
    const invalidated = invalidateAfterWrite(client, topicKeys.all);
    await settle();
    server.releaseAll();
    await invalidated;
    await settle();
  }

  it('refetches a list whose first load is still in flight', async () => {
    const stop = new QueryObserver(client, listOptions()).subscribe(() => {});

    await writeThenAnswer();

    expect(client.getQueryData(KEY)).toEqual(['old', 'new']);
    expect(server.requests()).toBe(2);
    stop();
  });

  it('refetches a paginated list whose first page is still in flight', async () => {
    const stop = new InfiniteQueryObserver(client, {
      ...listOptions(),
      initialPageParam: '',
      getNextPageParam: () => undefined,
    }).subscribe(() => {});

    await writeThenAnswer();

    expect(client.getQueryData(KEY)).toMatchObject({ pages: [['old', 'new']] });
    expect(server.requests()).toBe(2);
    stop();
  });

  // The user can leave the page before the first load answers. Nothing observes the query
  // then, and `staleTime: Infinity` would keep the late answer for the next visit.
  it('does not keep the pre-write answer of a first load nobody observes any more', async () => {
    new QueryObserver(client, listOptions()).subscribe(() => {})();

    await writeThenAnswer();
    const stop = new QueryObserver(client, listOptions()).subscribe(() => {});
    await settle();
    server.releaseAll();
    await settle();

    expect(client.getQueryData(KEY)).toEqual(['old', 'new']);
    stop();
  });

  // Cancelling a query that has data would hand its waiting caller the old rows. TanStack
  // already restarts those on invalidation, and the caller follows the new request.
  it('leaves a refetch of cached rows to the invalidation', async () => {
    client.setQueryData(KEY, ['old']);
    const stop = new QueryObserver(client, listOptions()).subscribe(() => {});
    const waiting = client.fetchQuery({ ...listOptions(), staleTime: 0 });

    await writeThenAnswer();

    await expect(waiting).resolves.toEqual(['old', 'new']);
    stop();
  });

  // `use-orgs.ts` awaits a cold `fetchQuery` for the permissions during an org switch, and
  // cancelling a query with no data rejects it. No write may reach that key.
  it('leaves the org switch’s permissions fetch alone for the keys mutations pass today', async () => {
    const permissions = client.fetchQuery({
      queryKey: permissionKeys.org('org-1'),
      queryFn: server.get,
    });
    const mutationKeys = [
      ['orgs'],
      ['flashcards'],
      topicKeys.all,
      flashcardKeys.all,
      flashcardKeys.decks.all,
      flashcardKeys.decks.detail('id'),
      ...flashcardKeys.afterDeckSuspend,
      questionKeys.all,
      questionKeys.banks.all,
      questionReportKeys.all,
      questionReportKeys.detail('id'),
      questionReportKeys.unreadCount,
      quizKeys.all,
      assignmentKeys.all,
      assignmentKeys.detail('id'),
      ...assignmentKeys.gradingInvalidations('id'),
      studentAssignmentKeys.all,
    ];

    await Promise.all(mutationKeys.map((key) => invalidateAfterWrite(client, key)));
    server.releaseAll();

    await expect(permissions).resolves.toEqual(['old']);
  });
});
