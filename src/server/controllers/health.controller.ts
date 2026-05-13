import { HealthService } from '@/server/services';
import type { HealthStatus } from '@/types';
import { ControllerResponse } from '@/lib/controller-response';

export class HealthController {
  async getStatus(): Promise<ControllerResponse<HealthStatus>> {
    const health = await HealthService.checkHealth();

    const statusCode = this.mapStatusToHttp(health.status);

    return {
      success: true,
      statusCode,
      data: health,
    };
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
