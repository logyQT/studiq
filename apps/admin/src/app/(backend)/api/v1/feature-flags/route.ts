import { featureFlagController } from '@admin/server/controllers/feature-flag.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  return toNextResponse(await featureFlagController.getAll());
}

export async function POST(request: Request) {
  const body = await request.json();
  return toNextResponse(await featureFlagController.create(body));
}
