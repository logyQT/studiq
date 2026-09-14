import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockSupabaseClient } from '#test/helpers/supabase-mock';
import { HealthService } from '@/server/services/health.service';

describe('HealthService', () => {
  let mock: ReturnType<typeof mockSupabaseClient>;
  let service: HealthService;

  beforeEach(() => {
    vi.clearAllMocks();
    mock = mockSupabaseClient();
    service = new HealthService(async () => mock as any);
  });

  describe('checkHealth', () => {
    it('returns healthy when supabase is up', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { code: 'PGRST205' } }),
        }),
      });

      const result = await service.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.services.supabase).toBe('up');
    });

    it('returns unhealthy when supabase is down', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { code: 'OTHER_ERROR' } }),
        }),
      });

      const result = await service.checkHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.services.supabase).toBe('down');
    });

    it('returns healthy when supabase query succeeds', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      const result = await service.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.services.supabase).toBe('up');
    });

    it('includes timestamp and uptime', async () => {
      mock.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { code: 'PGRST205' } }),
        }),
      });

      const result = await service.checkHealth();

      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.environment).toBeDefined();
      expect(result.responseTime).toBeDefined();
    });
  });
});
