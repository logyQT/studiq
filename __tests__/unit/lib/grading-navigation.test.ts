import { describe, expect, it } from 'vitest';
import {
  attemptNavigation,
  gradingShortcut,
  type NavigableAttempt,
} from '@/lib/grading-navigation';

const submitted = (id: string, graded = false): NavigableAttempt => ({
  id,
  completed_at: '2026-11-27T10:00:00Z',
  graded,
});
const running = (id: string): NavigableAttempt => ({ id, completed_at: null, graded: false });

describe('attemptNavigation (#1354)', () => {
  const attempts = [submitted('a'), submitted('b'), submitted('c')];

  it('gives the position and both neighbours in table order', () => {
    expect(attemptNavigation(attempts, 'b')).toMatchObject({
      position: 2,
      total: 3,
      previousId: 'a',
      nextId: 'c',
    });
  });

  it('wraps at both ends', () => {
    expect(attemptNavigation(attempts, 'a')?.previousId).toBe('c');
    expect(attemptNavigation(attempts, 'c')?.nextId).toBe('a');
  });

  it('has nowhere to go with a single attempt', () => {
    expect(attemptNavigation([submitted('a')], 'a')).toEqual({
      position: 1,
      total: 1,
      previousId: null,
      nextId: null,
      nextUngradedId: null,
      leftToGrade: 1,
    });
  });

  it('skips graded and running attempts on the way to the next ungraded one', () => {
    const mixed = [submitted('a'), submitted('b', true), running('c'), submitted('d')];

    expect(attemptNavigation(mixed, 'a')).toMatchObject({ nextUngradedId: 'd', leftToGrade: 2 });
  });

  it('wraps to an ungraded attempt before the current one', () => {
    const mixed = [submitted('a'), submitted('b', true), submitted('c', true)];

    expect(attemptNavigation(mixed, 'c')?.nextUngradedId).toBe('a');
  });

  it('does not offer the current attempt as the next ungraded one', () => {
    const mixed = [submitted('a'), submitted('b', true)];

    expect(attemptNavigation(mixed, 'a')).toMatchObject({ nextUngradedId: null, leftToGrade: 1 });
  });

  it('counts nothing left when the only unfinished attempt is still running', () => {
    expect(attemptNavigation([submitted('a', true), running('b')], 'a')).toMatchObject({
      nextUngradedId: null,
      leftToGrade: 0,
    });
  });

  it('is null for an attempt that is not in the list', () => {
    expect(attemptNavigation(attempts, 'x')).toBeNull();
  });
});

describe('gradingShortcut (#1354)', () => {
  it('maps the brackets and N in either case', () => {
    expect(['[', ']', 'n', 'N'].map(gradingShortcut)).toEqual([
      'previous',
      'next',
      'nextUngraded',
      'nextUngraded',
    ]);
  });

  it('ignores every other key', () => {
    expect(['g', 'Enter', ' ', '1'].map(gradingShortcut)).toEqual([null, null, null, null]);
  });
});
