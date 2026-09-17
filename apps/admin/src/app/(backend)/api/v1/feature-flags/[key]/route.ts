import { featureFlagController } from '@admin/server/controllers/feature-flag.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { key } = await params;
  return toNextResponse(await featureFlagController.getById(key));
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { key } = await params;
  const body = await request.json();
  return toNextResponse(await featureFlagController.update(key, body));
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { key } = await params;
  return toNextResponse(await featureFlagController.delete(key));
}
