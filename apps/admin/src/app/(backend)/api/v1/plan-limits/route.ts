import { planLimitController } from '@admin/server/controllers/plan-limit.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const planKey = url.searchParams.get('planKey') ?? undefined;
  return toNextResponse(await planLimitController.getAll(planKey));
}

export async function POST(request: Request) {
  const body = await request.json();
  return toNextResponse(await planLimitController.create(body));
}
