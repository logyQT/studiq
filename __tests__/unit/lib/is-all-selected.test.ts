import { describe, expect, it } from 'vitest';
import { isAllSelected } from '@/hooks/use-selection';

// #363: the deck view got a "Zaznacz Wszystkie" / "Odznacz Wszystkie" toggle; this decides
// which of the two it offers.

describe('isAllSelected', () => {
  it('is true when every listed id is selected', () => {
    expect(isAllSelected(['a', 'b', 'c'], new Set(['a', 'b', 'c']))).toBe(true);
  });

  it('is false while some listed ids are not selected', () => {
    expect(isAllSelected(['a', 'b', 'c'], new Set(['a', 'b']))).toBe(false);
  });

  it('ignores selected ids that are no longer listed', () => {
    expect(isAllSelected(['a', 'b'], new Set(['a', 'b', 'gone']))).toBe(true);
  });

  it('is false for an empty list, so "select all" is never offered as "deselect all"', () => {
    expect(isAllSelected([], new Set())).toBe(false);
    expect(isAllSelected([], new Set(['a']))).toBe(false);
  });
});
