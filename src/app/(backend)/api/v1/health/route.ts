import { toNextResponse } from '@/lib/http-utils';
import { healthController } from '@/server/controllers/health.controller';

export async function GET() {
  const response = await healthController.getStatus();
  return toNextResponse(response);
}
