import type { HealthStatus, ServiceStatus, AppStatus } from '@/types';
import { createClient } from '@/lib/supabase/server';

export class HealthService {
  private static TIMEOUT_MS = 3000;

  static async checkHealth(): Promise<HealthStatus> {
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

  private static async checkSupabase(): Promise<boolean> {
    try {
      const supabase = await createClient();

      const { error } = await supabase.from('_health_check_').select('*').limit(1);

      if (error) {
        return error.code === 'PGRST205';
      }

      return true;
    } catch (err: any) {
      return false;
    }
  }

  private static async withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), ms));

    return Promise.race([promise, timeout]);
  }

  private static calculateStatus(services: Record<string, ServiceStatus>): AppStatus {
    const values = Object.values(services);

    if (values.every((s) => s === 'up')) return 'healthy';
    if (values.every((s) => s === 'down')) return 'unhealthy';
    return 'degraded';
  }
}
