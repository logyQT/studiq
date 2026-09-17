import { authController } from '@studiq/server/controllers/auth.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function POST() {
  const response = await authController.logout();
  return toNextResponse(response);
}
