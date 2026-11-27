import { subscriptionPlanAdminController } from '@admin/server/controllers/subscription-plan-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await subscriptionPlanAdminController.getAssignments(id));
}

export async function POST(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const body: unknown = await request.json();
  return toNextResponse(await subscriptionPlanAdminController.assign(id, body));
}
