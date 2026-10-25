import { applyCramAction, cramActionForRating } from '@/lib/cram-queue';
import { describe, expect, it } from 'vitest';

describe('applyCramAction (#617)', () => {
  const queue = ['A', 'B', 'C'];

  it('keeps the queue untouched for "stay" so the same card is repeated', () => {
    expect(applyCramAction(queue, 'stay')).toEqual(['A', 'B', 'C']);
  });

  it('re-queues the front card at the end for "reset"', () => {
    expect(applyCramAction(queue, 'reset')).toEqual(['B', 'C', 'A']);
  });

  it('keeps a single-card queue on "reset" (it is already the only card)', () => {
    expect(applyCramAction(['A'], 'reset')).toEqual(['A']);
  });

  it('drops the front card for "next"', () => {
    expect(applyCramAction(queue, 'next')).toEqual(['B', 'C']);
  });

  it('drops the front card for "remove"', () => {
    expect(applyCramAction(queue, 'remove')).toEqual(['B', 'C']);
  });

  it('leaves an empty queue empty for every action', () => {
    for (const action of ['reset', 'stay', 'next', 'remove'] as const) {
      expect(applyCramAction([], action)).toEqual([]);
    }
  });

  it('does not mutate the input queue', () => {
    const input = [...queue];
    applyCramAction(input, 'reset');
    expect(input).toEqual(queue);
  });
});

describe('cramActionForRating (#617)', () => {
  it('maps the operator-approved 1–4 buttons to reset / stay / next / remove', () => {
    expect(cramActionForRating(1)).toBe('reset');
    expect(cramActionForRating(2)).toBe('stay');
    expect(cramActionForRating(3)).toBe('next');
    expect(cramActionForRating(4)).toBe('remove');
  });

  it('falls back to "remove" for an out-of-range rating', () => {
    expect(cramActionForRating(5)).toBe('remove');
    expect(cramActionForRating(0)).toBe('remove');
  });
});
