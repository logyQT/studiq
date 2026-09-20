import { organizationAdminController } from '@admin/server/controllers/organization-admin.controller';
import { toNextResponse } from '@studiq/server/lib/http-utils';

export async function GET() {
  return toNextResponse(await organizationAdminController.getAll());
}
