import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GET } from '@/app/(backend)/api/v1/health/route';
import { useRealSupabase } from './helpers';

describe('Health Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });
  describe('GET /api/v1/health', () => {
    it('returns health status and 200', async () => {
      const response = await GET();
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBeDefined();
    });

    it('returns required fields', async () => {
      const response = await GET();
      const body = await response.json();

      expect(body.data.timestamp).toBeDefined();
      expect(body.data.uptime).toBeDefined();
      expect(body.data.environment).toBeDefined();
      expect(body.data.services).toBeDefined();
      expect(body.data.responseTime).toBeDefined();
    });

    it('returns services object with supabase', async () => {
      const response = await GET();
      const body = await response.json();

      expect(body.data.services.supabase).toBeDefined();
      expect(['up', 'down']).toContain(body.data.services.supabase);
    });
  });
});
