import { describe, expect, it } from 'vitest';
import { parsePointsInput } from '@/lib/quiz-editor';

describe('parsePointsInput (#162)', () => {
  it('accepts a plain integer', () => {
    expect(parsePointsInput('5')).toBe(5);
  });

  it('ignores surrounding whitespace', () => {
    expect(parsePointsInput(' 5 ')).toBe(5);
  });

  it('accepts zero', () => {
    expect(parsePointsInput('0')).toBe(0);
  });

  it('returns null while the field is empty so the caller keeps the old value', () => {
    expect(parsePointsInput('')).toBeNull();
    expect(parsePointsInput('   ')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parsePointsInput('abc')).toBeNull();
    expect(parsePointsInput('Infinity')).toBeNull();
    expect(parsePointsInput('-')).toBeNull();
  });

  it('clamps negative values to zero', () => {
    expect(parsePointsInput('-3')).toBe(0);
  });

  it('truncates fractional values to an integer', () => {
    expect(parsePointsInput('2.9')).toBe(2);
  });
});
