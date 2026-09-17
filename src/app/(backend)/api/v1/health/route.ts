import { healthController } from '@studiq/server/controllers/health.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  const response = await healthController.getStatus();
  return toNextResponse(response);
}
