import { subscriptionPlanAdminController } from '@admin/server/controllers/subscription-plan-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ key: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { key } = await params;
  return toNextResponse(await subscriptionPlanAdminController.getById(key));
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { key } = await params;
  const body = await request.json();
  return toNextResponse(await subscriptionPlanAdminController.update(key, body));
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { key } = await params;
  return toNextResponse(await subscriptionPlanAdminController.delete(key));
}
