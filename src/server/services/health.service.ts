import { createClient } from '@/lib/supabase/server';
import type { AppStatus, HealthStatusResponse, ServiceStatus } from '@/server/models/health.model';

type HealthStatus = HealthStatusResponse;

export class HealthService {
  private TIMEOUT_MS = 3000;

  async checkHealth(): Promise<HealthStatus> {
    const start = Date.now();

    const [supabase] = await Promise.all([this.withTimeout(this.checkSupabase(), this.TIMEOUT_MS)]);

    const services = {
      supabase: supabase ? 'up' : ('down' as ServiceStatus),
    };

    const status = this.calculateStatus(services);

    return {
      status,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      environment: process.env.NODE_ENV || 'development',
      services,
      responseTime: Date.now() - start,
    };
  }

  private async checkSupabase(): Promise<boolean> {
    try {
      const supabase = await createClient();

      const { error } = await supabase.from('_health_check_').select('*').limit(1);

      if (error) {
        return error.code === 'PGRST205';
      }

      return true;
    } catch {
      return false;
    }
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

    return Promise.race([promise, timeout]);
  }

  private calculateStatus(services: Record<string, ServiceStatus>): AppStatus {
    const values = Object.values(services);

    if (values.every((s) => s === 'up')) return 'healthy';
    if (values.every((s) => s === 'down')) return 'unhealthy';
    return 'degraded';
  }
}

export const healthService = new HealthService();
