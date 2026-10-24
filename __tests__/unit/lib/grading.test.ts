import { describe, expect, it } from 'vitest';
import { parseGradePoints, resolveGradeDraft } from '@/lib/grading';

describe('resolveGradeDraft', () => {
  it('hydrates points and feedback from the persisted grade', () => {
    expect(
      resolveGradeDraft({ teacher_points: 2, teacher_feedback: 'Dobra odpowiedź' }, undefined),
    ).toEqual({ points: '2', feedback: 'Dobra odpowiedź' });
  });

  it('keeps a persisted 0 (not treated as missing)', () => {
    expect(resolveGradeDraft({ teacher_points: 0, teacher_feedback: '' }, undefined)).toEqual({
      points: '0',
      feedback: '',
    });
  });

  it('returns empty strings for an ungraded answer', () => {
    expect(resolveGradeDraft({ teacher_points: null, teacher_feedback: null }, undefined)).toEqual({
      points: '',
      feedback: '',
    });
  });

  it('returns empty strings when there is no saved answer at all', () => {
    expect(resolveGradeDraft(null, undefined)).toEqual({ points: '', feedback: '' });
    expect(resolveGradeDraft(undefined, undefined)).toEqual({ points: '', feedback: '' });
  });

  it('lets the draft win over the persisted grade', () => {
    expect(
      resolveGradeDraft(
        { teacher_points: 2, teacher_feedback: 'stara' },
        {
          points: '3',
          feedback: 'nowa',
        },
      ),
    ).toEqual({ points: '3', feedback: 'nowa' });
  });

  it('does not fall back to the saved grade after the teacher clears a field', () => {
    expect(
      resolveGradeDraft(
        { teacher_points: 2, teacher_feedback: 'stara' },
        {
          points: '',
          feedback: '',
        },
      ),
    ).toEqual({ points: '', feedback: '' });
  });

  it('fills the missing field of a partial draft from the persisted grade', () => {
    expect(
      resolveGradeDraft({ teacher_points: 2, teacher_feedback: 'stara' }, { points: '5' }),
    ).toEqual({ points: '5', feedback: 'stara' });
    expect(
      resolveGradeDraft({ teacher_points: 2, teacher_feedback: 'stara' }, { feedback: 'nowa' }),
    ).toEqual({ points: '2', feedback: 'nowa' });
  });
});

describe('parseGradePoints', () => {
  it('parses a plain integer', () => {
    expect(parseGradePoints('2')).toBe(2);
  });

  it('trims surrounding whitespace', () => {
    expect(parseGradePoints(' 2 ')).toBe(2);
  });

  it('accepts an explicit zero', () => {
    expect(parseGradePoints('0')).toBe(0);
  });

  it('returns null for empty or whitespace-only input', () => {
    expect(parseGradePoints('')).toBeNull();
    expect(parseGradePoints('   ')).toBeNull();
  });

  it('returns null for non-numeric input', () => {
    expect(parseGradePoints('abc')).toBeNull();
    expect(parseGradePoints('2abc')).toBeNull();
  });

  it('returns null for fractional or negative input', () => {
    expect(parseGradePoints('2.5')).toBeNull();
    expect(parseGradePoints('-1')).toBeNull();
  });
});
