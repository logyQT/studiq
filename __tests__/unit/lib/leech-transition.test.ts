import {
  type AnsweredCard,
  findLeechTransitions,
  indexAfterSuspension,
  type LeechPracticeResult,
} from '@/lib/leech-transition';
import { describe, expect, it } from 'vitest';

function result(overrides: Partial<LeechPracticeResult> = {}): LeechPracticeResult {
  return {
    flashcardId: 'fc-1',
    leechStage: 1,
    leechRestUntil: '2026-12-05T00:00:00.000Z',
    suspended: false,
    ...overrides,
  };
}

function answered(stage: number, front = 'Pytanie'): AnsweredCard {
  return { stage, front };
}

describe('findLeechTransitions (#1063)', () => {
  it('reports a card that moves from stage 0 to 1', () => {
    const transitions = findLeechTransitions([result()], new Map([['fc-1', answered(0)]]));

    expect(transitions).toEqual([
      {
        flashcardId: 'fc-1',
        front: 'Pytanie',
        leechRestUntil: '2026-12-05T00:00:00.000Z',
        suspended: false,
      },
    ]);
  });

  it('reports a card that moves from stage 1 to 2', () => {
    const transitions = findLeechTransitions(
      [result({ leechStage: 2, leechRestUntil: '2027-01-04T00:00:00.000Z' })],
      new Map([['fc-1', answered(1)]]),
    );

    expect(transitions).toEqual([
      {
        flashcardId: 'fc-1',
        front: 'Pytanie',
        leechRestUntil: '2027-01-04T00:00:00.000Z',
        suspended: false,
      },
    ]);
  });

  it('reports a card that moves from stage 2 to 3 as suspended with no rest date', () => {
    const transitions = findLeechTransitions(
      [result({ leechStage: 3, leechRestUntil: null, suspended: true })],
      new Map([['fc-1', answered(2)]]),
    );

    expect(transitions).toHaveLength(1);
    expect(transitions[0]).toMatchObject({ flashcardId: 'fc-1', suspended: true });
    expect(transitions[0]?.leechRestUntil).toBeNull();
  });

  it('reports nothing when the stage did not move', () => {
    expect(
      findLeechTransitions([result({ leechStage: 2 })], new Map([['fc-1', answered(2)]])),
    ).toEqual([]);
  });

  it('reports nothing for a result with no pre-stage (the card was never answered here)', () => {
    expect(findLeechTransitions([result()], new Map())).toEqual([]);
  });

  it('reports every transition in a multi-result batch and keeps the result order', () => {
    const transitions = findLeechTransitions(
      [
        result({ flashcardId: 'fc-1' }),
        result({ flashcardId: 'fc-2', leechStage: 2, suspended: false }),
        result({ flashcardId: 'fc-3', leechStage: 0, leechRestUntil: null }),
      ],
      new Map([
        ['fc-1', answered(0, 'Pierwsza')],
        ['fc-2', answered(1, 'Druga')],
        ['fc-3', answered(0, 'Trzecia')],
      ]),
    );

    expect(transitions.map((t) => t.flashcardId)).toEqual(['fc-1', 'fc-2']);
    expect(transitions.map((t) => t.front)).toEqual(['Pierwsza', 'Druga']);
  });

  it('does not mutate the pre-review map', () => {
    const preReview = new Map([['fc-1', answered(0)]]);
    findLeechTransitions([result()], preReview);

    expect(preReview.has('fc-1')).toBe(true);
  });
});

describe('indexAfterSuspension (#1063)', () => {
  it('shifts the index left when the suspended card is before the current card', () => {
    expect(indexAfterSuspension(1, 3)).toBe(2);
  });

  it('keeps the index when the suspended card is the current card', () => {
    expect(indexAfterSuspension(3, 3)).toBe(3);
  });

  it('keeps the index when the suspended card is after the current card', () => {
    expect(indexAfterSuspension(4, 3)).toBe(3);
  });

  it('keeps the index when the card is not in the visible list', () => {
    expect(indexAfterSuspension(-1, 3)).toBe(3);
  });
});
