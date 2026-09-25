import { HealthController } from '@studiq/server/controllers/health.controller';
import { beforeEach, describe, expect, it, vi } from 'vitest';

function createMockHealthService() {
  return {
    checkHealth: vi.fn(),
  };
}

describe('HealthController', () => {
  let mockService: ReturnType<typeof createMockHealthService>;
  let controller: HealthController;

  beforeEach(() => {
    vi.clearAllMocks();
    mockService = createMockHealthService();
    controller = new HealthController(mockService as any);
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
      mockService.checkHealth.mockResolvedValueOnce(healthStatus);

      const response = await controller.getStatus();

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
      mockService.checkHealth.mockResolvedValueOnce(healthStatus);

      const response = await controller.getStatus();

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
      mockService.checkHealth.mockResolvedValueOnce(healthStatus);

      const response = await controller.getStatus();

      expect(response).toEqual({
        success: true,
        statusCode: 503,
        data: healthStatus,
      });
    });

    it('returns 500 for unknown status', async () => {
      const healthStatus = {
        status: 'unknown' as any,
        timestamp: '2024-01-01T00:00:00.000Z',
        uptime: 100,
        environment: 'test',
        services: { supabase: 'unknown' },
        responseTime: 50,
      };
      mockService.checkHealth.mockResolvedValueOnce(healthStatus);

      const response = await controller.getStatus();

      expect(response).toEqual({
        success: true,
        statusCode: 500,
        data: healthStatus,
      });
    });
  });
});
