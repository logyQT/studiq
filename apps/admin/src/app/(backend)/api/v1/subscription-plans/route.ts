import { subscriptionPlanAdminController } from '@admin/server/controllers/subscription-plan-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  return toNextResponse(await subscriptionPlanAdminController.getAll());
}

export async function POST(request: Request) {
  const body = await request.json();
  return toNextResponse(await subscriptionPlanAdminController.create(body));
}
