import { userAdminController } from '@admin/server/controllers/user-admin.controller';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams);
  return toNextResponse(await userAdminController.list(query));
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    // Admin API routes have no withAuth() error wrapper, so an unparseable
    // body would otherwise throw out of the handler and surface as a 500.
    return toNextResponse(controllerResponse.error('BAD_REQUEST'));
  }

  return toNextResponse(await userAdminController.create(body));
}
