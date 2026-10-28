import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type BeforeResult, before, seedViaApi } from '#test/helpers/test-user';
import {
  cleanupFlashcardDecks,
  cleanupFlashcards,
  cleanupOrganizationDeep,
  mockUser,
} from '#test/integration/helpers';
import { createNextRequest } from '#test/integration/test-utils';
import { GET as getTeacherStats } from '@/app/(backend)/api/v1/flashcards/stats/teacher/route';

const suiteId = crypto.randomUUID().slice(0, 8);

/**
 * Regression coverage for issue #149 (EDU-DECK-06). `get_teacher_stats`
 * computed `summary.totalDecks` from every deck the caller owns, in every
 * organization and including empty decks, while `byDeck` — served in the same
 * payload and rendered as the "Podział na talie" table — only contained the
 * active organization's decks that actually hold flashcards. The "Talie"
 * summary card therefore disagreed with the table next to it and ignored the
 * org switch. The fix derives the `decks` CTE from the org-scoped
 * `deck_assignments`, so `summary.totalDecks === byDeck.length` by construction.
 *
 * Both assertions below fail on main: the educator owns 3 decks across the two
 * organizations, so `totalDecks` is 3 in both orgs instead of 1.
 */
describe(`Flashcard Stats Org Scope`, () => {
  let educator!: BeforeResult;
  let orgA!: BeforeResult;
  let orgB!: BeforeResult;
  let emptyDeckId!: string;

  beforeAll(async () => {
    // Same educator, two organizations: org A gets 2 decks and 1 card (so the
    // second deck stays empty), org B gets 1 deck and 1 card. A distinct org
    // name prefix keeps other concurrently running suites' prefix cleanups from
    // touching these orgs.
    educator = await before({
      role: 'educator',
      org: `fcstats-a-${suiteId}`,
      decks: 2,
      flashcards: 1,
    });
    orgB = await seedViaApi(educator.user, {
      org: `fcstats-b-${suiteId}`,
      decks: 1,
      flashcards: 1,
    });

    if (!educator.orgId || !orgB.orgId) throw new Error('[setup] org not created');
    orgA = educator;
    emptyDeckId = orgA.created.decks[1];
    if (!emptyDeckId) throw new Error('[setup] second deck not created');
    mockUser(educator.user);
  });

  afterAll(async () => {
    await cleanupFlashcards(educator.user.id);
    await cleanupFlashcardDecks(educator.user.id);
    for (const orgId of [orgA.orgId, orgB.orgId]) {
      if (orgId) await cleanupOrganizationDeep(orgId);
    }
  });

  async function fetchStats(
    orgId: string,
    query = '',
  ): Promise<{
    summary: { totalDecks: number };
    byDeck: Array<{ deckId: string }>;
  }> {
    mockUser(educator.user);
    const res = await getTeacherStats(
      createNextRequest(`http://localhost/api/v1/flashcards/stats/teacher${query}`, undefined, {
        active_org_id: orgId,
      }),
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    return body.data;
  }

  it('counts only the active organization’s decks and matches the by-deck table', async () => {
    const stats = await fetchStats(orgA.orgId ?? '');

    // Pre-fix this is 3 — the educator's decks in *both* orgs.
    expect(stats.summary.totalDecks).toBe(1);
    expect(stats.byDeck).toHaveLength(1);
    expect(stats.byDeck[0].deckId).toBe(orgA.created.decks[0]);
    expect(stats.summary.totalDecks).toBe(stats.byDeck.length);
  });

  it('switches with the active organization instead of leaking the other org', async () => {
    const stats = await fetchStats(orgB.orgId ?? '');

    expect(stats.summary.totalDecks).toBe(1);
    expect(stats.byDeck).toHaveLength(1);
    expect(stats.byDeck[0].deckId).toBe(orgB.created.decks[0]);
    expect(stats.summary.totalDecks).toBe(stats.byDeck.length);
  });

  it('does not count a deck without flashcards in the active organization', async () => {
    const stats = await fetchStats(orgA.orgId ?? '', `?deckId=${emptyDeckId}`);

    expect(stats.summary.totalDecks).toBe(0);
    expect(stats.byDeck).toHaveLength(0);
    expect(stats.summary.totalDecks).toBe(stats.byDeck.length);
  });
});
