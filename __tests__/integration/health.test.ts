import type { HealthStatusResponse } from '@studiq/server/models/health.model';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { json } from '#test/helpers/json';
import { useRealSupabase } from '#test/integration/helpers';
import { GET } from '@/app/(backend)/api/v1/health/route';

// Health is pure-read — no DB writes, no data isolation concerns.

/** `{ success, data }` envelope around the health payload. */
type HealthBody = { success: boolean; data: HealthStatusResponse };

describe('Health Integration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useRealSupabase();
  });

  describe('GET /api/v1/health', () => {
    it('returns health status and 200', async () => {
      const response = await GET();
      const body = await json<HealthBody>(response);

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data.status).toBeDefined();
    });

    it('returns required fields', async () => {
      const response = await GET();
      const body = await json<HealthBody>(response);

      expect(body.data.timestamp).toBeDefined();
      expect(body.data.uptime).toBeDefined();
      expect(body.data.environment).toBeDefined();
      expect(body.data.services).toBeDefined();
      expect(body.data.responseTime).toBeDefined();
    });

    it('returns services object with supabase', async () => {
      const response = await GET();
      const body = await json<HealthBody>(response);

      expect(body.data.services.supabase).toBeDefined();
      expect(['up', 'down']).toContain(body.data.services.supabase);
    });
  });
});
