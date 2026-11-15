import { availableSeats } from '@/lib/seats';
import { describe, expect, it } from 'vitest';

describe('availableSeats (#1068)', () => {
  it('subtracts the assignments from the pool total', () => {
    expect(availableSeats(10, 3)).toBe(7);
  });

  it('never reports a negative count for a pool below its assigned count', () => {
    // Pre-fix rows can still carry total < assigned (the service accepted it and
    // nothing clamped the read), so the seats page must not render "-1".
    expect(availableSeats(0, 1)).toBe(0);
    expect(availableSeats(1, 4)).toBe(0);
  });
});
