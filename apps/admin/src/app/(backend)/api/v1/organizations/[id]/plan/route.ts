import { subscriptionPlanAdminController } from '@admin/server/controllers/subscription-plan-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const body: unknown = await request.json();
  return toNextResponse(await subscriptionPlanAdminController.setOrganizationPlan(id, body));
}
