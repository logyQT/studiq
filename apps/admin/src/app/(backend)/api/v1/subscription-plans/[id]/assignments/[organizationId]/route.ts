import { subscriptionPlanAdminController } from '@admin/server/controllers/subscription-plan-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string; organizationId: string }> };

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id, organizationId } = await params;
  return toNextResponse(await subscriptionPlanAdminController.unassign(id, organizationId));
}
