const DEFAULT_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours
const DEFAULT_MAX_ENTRIES = 1000;

interface CacheEntry {
  text: string;
  fileName: string;
  extractedAt: Date;
  lastAccessed: Date;
}

export class PdfCacheService {
  private cache = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxEntries: number;

  constructor(ttlMs = DEFAULT_TTL_MS, maxEntries = DEFAULT_MAX_ENTRIES) {
    this.ttlMs = ttlMs;
    this.maxEntries = maxEntries;

    // Periodic cleanup every 10 minutes
    setInterval(() => this.evictExpired(), 10 * 60 * 1000).unref();
  }

  set(conversationId: string, text: string, fileName: string): void {
    // Evict LRU if at capacity
    if (this.cache.size >= this.maxEntries && !this.cache.has(conversationId)) {
      this.evictLRU();
    }

    this.cache.set(conversationId, {
      text,
      fileName,
      extractedAt: new Date(),
      lastAccessed: new Date(),
    });
  }

  get(conversationId: string): { text: string; fileName: string } | null {
    const entry = this.cache.get(conversationId);
    if (!entry) {
      return null;
    }

    // Check TTL
    if (Date.now() - entry.extractedAt.getTime() > this.ttlMs) {
      this.cache.delete(conversationId);
      return null;
    }

    // Update access time for LRU
    entry.lastAccessed = new Date();
    return { text: entry.text, fileName: entry.fileName };
  }

  delete(conversationId: string): void {
    this.cache.delete(conversationId);
  }

  private evictExpired(): void {
    const now = Date.now();
    let _evicted = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.extractedAt.getTime() > this.ttlMs) {
        this.cache.delete(key);
        _evicted++;
      }
    }
  }

  private evictLRU(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastAccessed.getTime() < oldestTime) {
        oldestTime = entry.lastAccessed.getTime();
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

export const pdfCacheService = new PdfCacheService();
