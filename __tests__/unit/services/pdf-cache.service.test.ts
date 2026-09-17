import { PdfCacheService } from '@studiq/server/services/pdf-cache.service';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('PdfCacheService', () => {
  let service: PdfCacheService;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new PdfCacheService(60_000, 3); // 1 min TTL, 3 max entries
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('set and get', () => {
    it('stores and retrieves a value', () => {
      service.set('conv-1', 'text content', 'file.pdf');

      const result = service.get('conv-1');

      expect(result).toEqual({ text: 'text content', fileName: 'file.pdf' });
    });

    it('returns null for missing key', () => {
      expect(service.get('nonexistent')).toBeNull();
    });

    it('returns null after TTL expires', () => {
      service.set('conv-1', 'text', 'file.pdf');

      vi.advanceTimersByTime(61_000); // 61 seconds > 1 min TTL

      expect(service.get('conv-1')).toBeNull();
    });

    it('updates lastAccessed on get', () => {
      service.set('conv-1', 'text', 'file.pdf');

      vi.advanceTimersByTime(30_000);
      service.get('conv-1'); // update access time

      vi.advanceTimersByTime(30_000);
      // Should still exist because lastAccessed was updated
      expect(service.get('conv-1')).not.toBeNull();
    });
  });

  describe('delete', () => {
    it('deletes a value', () => {
      service.set('conv-1', 'text', 'file.pdf');
      service.delete('conv-1');

      expect(service.get('conv-1')).toBeNull();
    });
  });

  describe('LRU eviction', () => {
    it('evicts oldest entry when at capacity', () => {
      service.set('c1', 'text1', 'f1.pdf');
      service.set('c2', 'text2', 'f2.pdf');
      service.set('c3', 'text3', 'f3.pdf');

      // Now at capacity (3). Adding a 4th should evict c1 (oldest)
      service.set('c4', 'text4', 'f4.pdf');

      expect(service.get('c1')).toBeNull();
      expect(service.get('c4')).toEqual({ text: 'text4', fileName: 'f4.pdf' });
    });
  });
});
