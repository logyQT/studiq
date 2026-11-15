import { describe, expect, it } from 'vitest';
import { partialList, partialObject, partialText } from '@studiq/server/lib/partial-result';

describe('partial result boundary', () => {
  it('keeps a present field and falls back when a partial result omits it', () => {
    expect(partialList([1, 2])).toEqual([1, 2]);
    expect(partialList(undefined)).toEqual([]);

    expect(partialObject({ inputTokens: 3 })).toEqual({ inputTokens: 3 });
    expect(partialObject(undefined)).toEqual({});

    expect(partialText('ok')).toBe('ok');
    expect(partialText(undefined)).toBe('');
  });
});
