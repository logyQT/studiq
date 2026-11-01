import { questionPagerTotal } from '@/lib/question-list-state';
import { describe, expect, it } from 'vitest';

// #668 QA (CodeRabbit): a failed page or filter request dropped the list data, `total` fell to 0
// and the pager unmounted with the table — after a failed "next page" there was no way back.
// The total of the last page that loaded for the same bank survives the error.

describe('questionPagerTotal', () => {
  it('uses the total of the loaded page', () => {
    expect(
      questionPagerTotal({ current: 50, lastLoaded: { bankId: 'b1', total: 25 }, bankId: 'b1' }),
    ).toBe(50);
  });

  it('keeps the last loaded total when the request failed', () => {
    expect(
      questionPagerTotal({
        current: undefined,
        lastLoaded: { bankId: 'b1', total: 50 },
        bankId: 'b1',
      }),
    ).toBe(50);
  });

  it('ignores a total loaded for another bank', () => {
    expect(
      questionPagerTotal({
        current: undefined,
        lastLoaded: { bankId: 'b1', total: 50 },
        bankId: 'b2',
      }),
    ).toBe(0);
  });

  it('is 0 before the first page loads', () => {
    expect(questionPagerTotal({ current: undefined, lastLoaded: undefined, bankId: 'b1' })).toBe(0);
  });
});
