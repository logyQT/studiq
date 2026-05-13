import { healthController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';

export async function GET() {
  const response = await healthController.getStatus();
  return toNextResponse(response);
}
