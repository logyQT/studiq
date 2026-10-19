import { userAdminController } from '@admin/server/controllers/user-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await userAdminController.restore(id));
}
