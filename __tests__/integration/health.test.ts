import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from '@/app/(backend)/api/v1/health/route';
import { applyRegisteredMock } from '#test/integration/helpers';
import { forEachCopy, registerMock } from '#test/helpers/concurrent';

// Health is pure-read — no DB writes, no data isolation concerns.
// 3× wrapper proves mock isolation (useRealSupabase × 3).

forEachCopy((copyId) => {
  describe(`Health Integration [${copyId}]`, () => {
    // Register null = useRealSupabase (health endpoint needs real DB)
    registerMock(copyId, null);

    beforeEach(() => {
      vi.clearAllMocks();
      applyRegisteredMock(copyId);
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
});
