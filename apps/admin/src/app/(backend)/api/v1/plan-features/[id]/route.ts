import { planFeatureController } from '@admin/server/controllers/plan-feature.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await planFeatureController.getAll());
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await planFeatureController.delete(id));
}
