import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import type { HealthStatusResponse } from '@/server/models';
import { healthService } from '@/server/services';

export class HealthController {
  async getStatus(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const health = await healthService.checkHealth();

      const statusCode = mapStatusToHttp(health.status);

      return {
        success: true,
        statusCode,
        data: health,
      } as ControllerResponse;
    });
  }
}

function mapStatusToHttp(status: HealthStatusResponse['status']): number {
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
