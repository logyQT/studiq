import { describe, it, expect, vi, beforeEach } from 'vitest';
import { healthController } from './health.controller';
import { HealthService } from '@/server/services';

vi.mock('@/server/services', () => ({
  HealthService: {
    checkHealth: vi.fn(),
  },
}));

const mockHealthService = vi.mocked(HealthService);

describe('HealthController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getStatus', () => {
    it('returns 200 when healthy', async () => {
      const healthStatus = {
        status: 'healthy' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 100,
        environment: 'test',
        services: { supabase: 'up' },
        responseTime: 50,
      };
      mockHealthService.checkHealth.mockResolvedValueOnce(healthStatus as any);

      const response = await healthController.getStatus();

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: healthStatus,
      });
    });

    it('returns 200 when degraded', async () => {
      const healthStatus = {
        status: 'degraded' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 100,
        environment: 'test',
        services: { supabase: 'up' },
        responseTime: 50,
      };
      mockHealthService.checkHealth.mockResolvedValueOnce(healthStatus as any);

      const response = await healthController.getStatus();

      expect(response).toEqual({
        success: true,
        statusCode: 200,
        data: healthStatus,
      });
    });

    it('returns 503 when unhealthy', async () => {
      const healthStatus = {
        status: 'unhealthy' as const,
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 100,
        environment: 'test',
        services: { supabase: 'down' },
        responseTime: 50,
      };
      mockHealthService.checkHealth.mockResolvedValueOnce(healthStatus as any);

      const response = await healthController.getStatus();

      expect(response).toEqual({
        success: true,
        statusCode: 503,
        data: healthStatus,
      });
    });
  });
});
