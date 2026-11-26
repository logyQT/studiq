import type { FlashcardData } from '@/components/ai/generated-cards';
import { ApiError, apiGet, apiPost } from '@/lib/api';

export interface TopicRef {
  id: string;
  name: string;
}

/** The kept cards that share one topic; `name` is null for the cards without one. */
export interface TopicGroup {
  name: string | null;
  /** The caller's own topic of that name, or null when it has to be created. */
  topicId: string | null;
  /** Positions in the generated list. */
  indices: number[];
}

const topicKey = (name: string) => name.normalize('NFC').toLowerCase();

/** Groups the kept cards by topic name, ignoring case, in order of first appearance. */
export function planTopicGroups(
  cards: readonly FlashcardData[],
  skipped: ReadonlySet<number>,
  existing: readonly TopicRef[],
): TopicGroup[] {
  const existingIds = new Map<string, string>();
  for (const topic of existing) {
    const key = topicKey(topic.name.trim());
    if (!existingIds.has(key)) existingIds.set(key, topic.id);
  }

  const groups = new Map<string, TopicGroup>();
  cards.forEach((card, index) => {
    if (skipped.has(index)) return;
    const name = card.topic?.trim() || null;
    // No topic name is empty, so '' is free to key the untagged cards.
    const key = name === null ? '' : topicKey(name);
    const group = groups.get(key);
    if (group) group.indices.push(index);
    else groups.set(key, { name, topicId: existingIds.get(key) ?? null, indices: [index] });
  });
  return [...groups.values()];
}

/** Every topic the caller owns in the active scope, oldest first. */
async function fetchOwnTopics(): Promise<TopicRef[]> {
  const topics: TopicRef[] = [];
  let cursor: string | null = null;
  do {
    const query = new URLSearchParams({
      owner: 'mine',
      sortBy: 'created_at',
      sortOrder: 'asc',
      limit: '100',
    });
    if (cursor) query.set('cursor', cursor);
    const page: { items: TopicRef[]; nextCursor: string | null } = await apiGet(
      `/api/v1/topics?${query.toString()}`,
    );
    topics.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor);
  return topics;
}

/**
 * True only for a 4xx answer: the API refused the request and wrote nothing. After a lost
 * connection, a 5xx or another error, the write can be complete.
 */
function isRefused(error: unknown): boolean {
  return error instanceof ApiError && error.status >= 400 && error.status < 500;
}

/** What a failed save tells the user, and whether the next save must use the same deck. */
export function describeSaveFailure(error: unknown, savedCount: number, deckReady: boolean) {
  if (deckReady && !isRefused(error)) {
    return { messageKey: 'flashcard_save_uncertain', keepDeck: true } as const;
  }
  return savedCount > 0
    ? ({ messageKey: 'flashcard_saved_partially', keepDeck: true } as const)
    : ({ messageKey: 'flashcard_save_failed', keepDeck: false } as const);
}

const createBatch = (body: object) => apiPost<unknown>('/api/v1/flashcards/batch/create', body);

interface SaveCardsOptions {
  deckId: string;
  cards: readonly FlashcardData[];
  /** Cards the visitor removed, plus any an earlier attempt already saved. */
  skipped: ReadonlySet<number>;
  keepTopics: boolean;
  /** Reports each batch as it lands, so a retry after a later failure can skip it. */
  onSaved: (indices: number[]) => void;
}

export interface SaveCardsResult {
  topicCount: number;
  /** Some cards were saved without the topic they should have. */
  topicsFailed: boolean;
}

/**
 * Saves the cards into a deck, one `batch/create` call per topic. The endpoint
 * does not return the new cards in input order, so a topic can only be attached
 * by creating its cards together. A topic problem never costs the user a card;
 * a failure to save the cards themselves is thrown.
 */
export async function saveCards({
  deckId,
  cards,
  skipped,
  keepTopics,
  onSaved,
}: SaveCardsOptions): Promise<SaveCardsResult> {
  const untagged = cards.map(({ front, back }) => ({ front, back }));
  let groups = planTopicGroups(untagged, skipped, []);
  let topicsFailed = false;

  if (keepTopics && planTopicGroups(cards, skipped, []).some((group) => group.name !== null)) {
    try {
      groups = planTopicGroups(cards, skipped, await fetchOwnTopics());
    } catch {
      // Without the list, creating topics could duplicate the ones the user has.
      topicsFailed = true;
    }
  }

  let topicCount = 0;
  for (const group of groups) {
    let topicId = group.topicId;
    if (topicId === null && group.name !== null) {
      try {
        topicId = (await apiPost<TopicRef>('/api/v1/topics', { name: group.name })).id;
      } catch {
        topicsFailed = true;
      }
    }

    const batch = { deckId, cards: group.indices.map((index) => untagged[index]) };
    if (topicId === null) {
      await createBatch(batch);
    } else {
      try {
        await createBatch({ ...batch, topicIds: [topicId] });
        topicCount += 1;
      } catch (error) {
        if (!isRefused(error)) throw error;
        // The cards and their topic are written in one transaction, so a refusal left neither.
        await createBatch(batch);
        topicsFailed = true;
      }
    }
    onSaved(group.indices);
  }

  return { topicCount, topicsFailed };
}
