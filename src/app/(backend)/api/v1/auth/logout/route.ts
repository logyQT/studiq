import { toNextResponse } from '@/lib/http-utils';
import { authController } from '@/server/controllers/auth.controller';

export async function POST() {
  const response = await authController.logout();
  return toNextResponse(response);
}
