import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthService } from './health.service';
import { createClient } from '@/lib/supabase/server';

describe('HealthService', () => {
  let mockSupabase: any;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = { from: vi.fn() };
    vi.mocked(createClient).mockResolvedValue(mockSupabase);
  });

  describe('checkHealth', () => {
    it('returns healthy when supabase is up', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { code: 'PGRST205' } }),
        }),
      });

      const result = await HealthService.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.services.supabase).toBe('up');
    });

    it('returns unhealthy when supabase is down', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { code: 'OTHER_ERROR' } }),
        }),
      });

      const result = await HealthService.checkHealth();

      expect(result.status).toBe('unhealthy');
      expect(result.services.supabase).toBe('down');
    });

    it('returns healthy when supabase query succeeds', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: null }),
        }),
      });

      const result = await HealthService.checkHealth();

      expect(result.status).toBe('healthy');
      expect(result.services.supabase).toBe('up');
    });

    it('includes timestamp and uptime', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ error: { code: 'PGRST205' } }),
        }),
      });

      const result = await HealthService.checkHealth();

      expect(result.timestamp).toBeDefined();
      expect(result.uptime).toBeDefined();
      expect(result.environment).toBeDefined();
      expect(result.responseTime).toBeDefined();
    });
  });
});
