import { userAdminController } from '@admin/server/controllers/user-admin.controller';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await userAdminController.getById(id));
}

export async function PUT(request: Request, { params }: RouteContext) {
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Admin API routes have no withAuth() error wrapper, so an unparseable
    // body would otherwise throw out of the handler and surface as a 500.
    return toNextResponse(controllerResponse.error('BAD_REQUEST'));
  }

  return toNextResponse(await userAdminController.updateAccountType(id, body));
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  return toNextResponse(await userAdminController.softDelete(id));
}
