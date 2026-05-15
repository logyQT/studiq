import { HealthService } from '@/server/services';
import { AppError } from '@/lib/errors';
import type { HealthStatus } from '@/types';
import { ControllerResponse } from '@/lib/controller-response';

export class HealthController {
  async getStatus(): Promise<ControllerResponse<HealthStatus>> {
    try {
      const health = await HealthService.checkHealth();

      const statusCode = this.mapStatusToHttp(health.status);

      return {
        success: true,
        statusCode,
        data: health,
      };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  private mapStatusToHttp(status: HealthStatus['status']): number {
    switch (status) {
      case 'healthy':
        return 200;
      case 'degraded':
        return 200;
      case 'unhealthy':
        return 503;
      default:
        return 500;
    }
  }
}

export const healthController = new HealthController();
