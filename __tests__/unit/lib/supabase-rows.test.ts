import { describe, expect, it } from 'vitest';
import { dbCount, dbRows } from '@studiq/server/lib/supabase/rows';

describe('supabase row boundary', () => {
  describe('dbRows', () => {
    it('keeps the rows of a complete payload', () => {
      const rows = [{ id: 'a' }];
      expect(dbRows(rows)).toEqual(rows);
    });

    it('turns a null list read into an empty list', () => {
      expect(dbRows<{ id: string }>(null)).toEqual([]);
    });
  });

  describe('dbCount', () => {
    it('reads the aggregate row of a populated count embed', () => {
      expect(dbCount([{ count: 7 }])).toBe(7);
    });

    it('reads an empty or missing embed as zero', () => {
      expect(dbCount([])).toBe(0);
      expect(dbCount(undefined)).toBe(0);
    });
  });
});
