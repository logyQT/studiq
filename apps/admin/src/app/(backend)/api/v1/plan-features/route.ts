import { planFeatureController } from '@admin/server/controllers/plan-feature.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  return toNextResponse(await planFeatureController.getAll());
}

export async function POST(request: Request) {
  const body = await request.json();
  return toNextResponse(await planFeatureController.create(body));
}
