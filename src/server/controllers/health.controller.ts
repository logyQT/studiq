import { HealthService } from '@/server/services';
import type { HealthStatus } from '@/types';

export class HealthController {
  /**
   * Returns health + proper HTTP status for probes
   */
  static async getStatus(): Promise<{
    body: HealthStatus;
    statusCode: number;
  }> {
    const health = await HealthService.checkHealth();

    const statusCode = this.mapStatusToHttp(health.status);

    return {
      body: health,
      statusCode,
    };
  }

  /**
   * Maps app health → HTTP status (for Kubernetes / Docker / Vercel)
   */
  private static mapStatusToHttp(status: HealthStatus['status']): number {
    switch (status) {
      case 'healthy':
        return 200;
      case 'degraded':
        return 200; // still alive, don't restart container
      case 'unhealthy':
        return 503; // trigger restart
      default:
        return 500;
    }
  }
}
