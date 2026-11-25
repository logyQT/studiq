import { beforeEach, describe, expect, it, vi } from 'vitest';
import { planTopicGroups, saveCards } from '@/lib/ai-chat-flashcard-topics';
import { ApiError, apiGet, apiPost } from '@/lib/api';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  apiGet: vi.fn(),
  apiPost: vi.fn(),
}));

const card = (front: string, topic?: string) => ({ front, back: `${front}!`, topic });
const plain = (front: string) => ({ front, back: `${front}!` });

const posted = (url: string) =>
  vi
    .mocked(apiPost)
    .mock.calls.filter(([called]) => called === url)
    .map(([, body]) => body);
const batches = () => posted('/api/v1/flashcards/batch/create');

describe('planTopicGroups (#1330)', () => {
  it('reuses an existing topic whatever its case, keeping the oldest of two namesakes', () => {
    const groups = planTopicGroups([card('a', 'MITOCHONDRIA ')], new Set(), [
      { id: 'old', name: ' Mitochondria' },
      { id: 'new', name: 'mitochondria' },
    ]);

    expect(groups).toEqual([{ name: 'MITOCHONDRIA', topicId: 'old', indices: [0] }]);
  });

  it('creates one new topic for spellings that differ only in case, Polish letters included', () => {
    const groups = planTopicGroups(
      [card('a', 'Jądro'), card('b', 'JĄDRO'), card('c', ' jądro ')],
      new Set(),
      [],
    );

    expect(groups).toEqual([{ name: 'Jądro', topicId: null, indices: [0, 1, 2] }]);
  });

  it('skips removed cards and drops a topic they leave empty', () => {
    const groups = planTopicGroups(
      [card('a', 'Cell'), card('b', 'Ribosomes'), card('c', 'Cell')],
      new Set([1, 2]),
      [],
    );

    expect(groups).toEqual([{ name: 'Cell', topicId: null, indices: [0] }]);
  });

  it('leaves cards without a topic, or with a blank one, untagged', () => {
    const groups = planTopicGroups([card('a'), card('b', '   '), card('c', 'Cell')], new Set(), []);

    expect(groups).toEqual([
      { name: null, topicId: null, indices: [0, 1] },
      { name: 'Cell', topicId: null, indices: [2] },
    ]);
  });
});

describe('saveCards (#1330)', () => {
  const cards = [card('a', 'Cell'), card('b', 'Nucleus'), card('c')];
  let refuse: (url: string, body: unknown) => Error | undefined;
  const onSaved = vi.fn();

  const save = (options: { keepTopics?: boolean; skipped?: Set<number> } = {}) =>
    saveCards({
      deckId: 'deck',
      cards,
      skipped: options.skipped ?? new Set(),
      keepTopics: options.keepTopics ?? true,
      onSaved,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    refuse = () => undefined;
    vi.mocked(apiGet).mockResolvedValue({
      items: [{ id: 'cell-id', name: 'cell' }],
      nextCursor: null,
    });
    vi.mocked(apiPost).mockImplementation((url, body) => {
      const error = refuse(url, body);
      return error ? Promise.reject(error) : Promise.resolve({ id: 'created-id' });
    });
  });

  it('creates only the missing topic and writes each topic’s cards with its id', async () => {
    await expect(save()).resolves.toEqual({ topicCount: 2, topicsFailed: false });

    expect(posted('/api/v1/topics')).toEqual([{ name: 'Nucleus' }]);
    expect(batches()).toEqual([
      { deckId: 'deck', cards: [plain('a')], topicIds: ['cell-id'] },
      { deckId: 'deck', cards: [plain('b')], topicIds: ['created-id'] },
      { deckId: 'deck', cards: [plain('c')] },
    ]);
  });

  it('matches a topic that is only on a later page of the list', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({ items: [], nextCursor: 'a+b=' })
      .mockResolvedValueOnce({ items: [{ id: 'far-id', name: 'Nucleus' }], nextCursor: null });

    await save({ skipped: new Set([0, 2]) });

    expect(vi.mocked(apiGet).mock.calls[1]?.[0]).toContain('cursor=a%2Bb%3D');
    expect(posted('/api/v1/topics')).toEqual([]);
    expect(batches()).toEqual([{ deckId: 'deck', cards: [plain('b')], topicIds: ['far-id'] }]);
  });

  it('writes one batch and touches no topic when topics are not kept', async () => {
    await expect(save({ keepTopics: false })).resolves.toEqual({
      topicCount: 0,
      topicsFailed: false,
    });

    expect(apiGet).not.toHaveBeenCalled();
    expect(posted('/api/v1/topics')).toEqual([]);
    expect(batches()).toEqual([{ deckId: 'deck', cards: ['a', 'b', 'c'].map(plain) }]);
  });

  it('saves every card untagged when the topic list cannot be read', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiError('INTERNAL_SERVER', 500));

    await expect(save()).resolves.toEqual({ topicCount: 0, topicsFailed: true });

    expect(posted('/api/v1/topics')).toEqual([]);
    expect(batches()).toEqual([{ deckId: 'deck', cards: ['a', 'b', 'c'].map(plain) }]);
  });

  it('saves the cards untagged when their topic cannot be created', async () => {
    refuse = (url) => (url === '/api/v1/topics' ? new ApiError('FORBIDDEN', 403) : undefined);

    await expect(save()).resolves.toEqual({ topicCount: 1, topicsFailed: true });

    expect(batches()[1]).toEqual({ deckId: 'deck', cards: [plain('b')] });
  });

  it('retries a batch the API refused without its topic', async () => {
    refuse = (_url, body) =>
      JSON.stringify(body).includes('cell-id') ? new ApiError('BAD_REQUEST', 400) : undefined;

    await expect(save()).resolves.toEqual({ topicCount: 1, topicsFailed: true });

    expect(batches().slice(0, 2)).toEqual([
      { deckId: 'deck', cards: [plain('a')], topicIds: ['cell-id'] },
      { deckId: 'deck', cards: [plain('a')] },
    ]);
    expect(onSaved.mock.calls).toEqual([[[0]], [[1]], [[2]]]);
  });

  it.each([
    ['a lost connection', new ApiError('NETWORK_ERROR', 0)],
    ['a gateway timeout', new ApiError('TIMEOUT', 504)],
  ])('does not resend a batch after %s, which may have been written', async (_label, error) => {
    refuse = (url) => (url === '/api/v1/flashcards/batch/create' ? error : undefined);

    await expect(save()).rejects.toBe(error);

    expect(batches()).toHaveLength(1);
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('reports only the batches that landed when a later one cannot be saved', async () => {
    refuse = (_url, body) =>
      JSON.stringify(body).includes('"b!"') ? new ApiError('USAGE_LIMIT_EXCEEDED', 429) : undefined;

    await expect(save()).rejects.toThrow('USAGE_LIMIT_EXCEEDED');

    expect(onSaved.mock.calls).toEqual([[[0]]]);
  });
});
