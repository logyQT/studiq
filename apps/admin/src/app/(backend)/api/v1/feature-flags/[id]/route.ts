import { featureFlagController } from '@admin/server/controllers/feature-flag.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await featureFlagController.getById(id));
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const body = await request.json();
  return toNextResponse(await featureFlagController.update(id, body));
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await featureFlagController.delete(id));
}
