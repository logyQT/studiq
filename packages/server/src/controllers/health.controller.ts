import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { type HealthService, healthService } from '@studiq/server/services/health.service';

export class HealthController {
  constructor(private service: HealthService) {}

  async getStatus(): Promise<ControllerResponse> {
    const health = await this.service.checkHealth();

    const statusCode = mapStatusToHttp(health.status);

    return controllerResponse.success(health, statusCode);
  }
}

function mapStatusToHttp(status: string): number {
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
export const healthController = wrapService(
  new HealthController(healthService),
  'health.controller',
);
