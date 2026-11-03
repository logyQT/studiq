import { AppError } from '@studiq/server/lib/errors';
import { decodeCursor, encodeCursor } from '@studiq/server/lib/query-list';
import { describe, expect, it } from 'vitest';

describe('cursor helpers', () => {
  it('round-trips a value and id', () => {
    expect(decodeCursor(encodeCursor('2024-01-02T00:00:00Z', 'row-2'))).toEqual({
      v: '2024-01-02T00:00:00Z',
      id: 'row-2',
    });
  });

  it('rejects a non-JSON cursor as BAD_REQUEST', () => {
    const cursor = Buffer.from('not json').toString('base64');
    expect(() => decodeCursor(cursor)).toThrow(AppError);
  });

  it('rejects a valid-JSON cursor with the wrong shape as BAD_REQUEST', () => {
    const cursor = Buffer.from(JSON.stringify({ v: 1 })).toString('base64');
    expect(() => decodeCursor(cursor)).toThrow(AppError);
  });
});
