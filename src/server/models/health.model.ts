export type ServiceStatus = 'up' | 'down';
export type AppStatus = 'healthy' | 'degraded' | 'unhealthy';

export interface HealthStatusResponse {
  status: AppStatus;
  timestamp: string;
  uptime: number;
  environment: string;

  services: {
    supabase: ServiceStatus;
  };

  responseTime: number; // ms
}
