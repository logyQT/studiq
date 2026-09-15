import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import { type HealthService, healthService } from '@/server/services/health.service';

export class HealthController {
  constructor(private healthService: HealthService) {}

  async getStatus(): Promise<ControllerResponse> {
    const health = await this.healthService.checkHealth();

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
