import { HealthService } from '@/server/services';
import type { HealthStatus } from '@/types';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';

export class HealthController {
  async getStatus(): Promise<ControllerResponse<HealthStatus>> {
    return withErrorHandling(async () => {
      const health = await HealthService.checkHealth();

      const statusCode = mapStatusToHttp(health.status);

      return {
        success: true,
        statusCode,
        data: health,
      };
    });
  }
}

function mapStatusToHttp(status: HealthStatus['status']): number {
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

export const healthController = new HealthController();
