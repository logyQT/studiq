import { userOverrideController } from '@admin/server/controllers/user-override.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  return toNextResponse(await userOverrideController.getAll());
}

export async function POST(request: Request) {
  const body = await request.json();
  return toNextResponse(await userOverrideController.create(body));
}
