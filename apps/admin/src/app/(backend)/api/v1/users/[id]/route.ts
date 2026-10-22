import { userAdminController } from '@admin/server/controllers/user-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await userAdminController.getById(id));
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;
  const body = await request.json();
  return toNextResponse(await userAdminController.updateAccountType(id, body));
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await userAdminController.softDelete(id));
}
