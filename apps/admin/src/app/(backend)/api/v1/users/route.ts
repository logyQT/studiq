import { userAdminController } from '@admin/server/controllers/user-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const query = Object.fromEntries(url.searchParams);
  return toNextResponse(await userAdminController.list(query));
}

export async function POST(request: Request) {
  const body = await request.json();
  return toNextResponse(await userAdminController.create(body));
}
