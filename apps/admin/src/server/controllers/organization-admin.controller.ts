import { createClient } from '@admin/lib/supabase/admin-client';
import {
  type ControllerResponse,
  controllerResponse,
} from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import { OrganizationIdParamsSchema } from '@studiq/server/models/organization.model';
import {
  OrganizationService,
  type OrganizationService as OrganizationServiceType,
} from '@studiq/server/services/organization.service';

export class OrganizationAdminController {
  constructor(private organizationService: OrganizationServiceType) {}

  async getAll(): Promise<ControllerResponse> {
    const result = await this.organizationService.getAll();
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const parsedId = OrganizationIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const result = await this.organizationService.getById(parsedId.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getDetails(id: string): Promise<ControllerResponse> {
    const parsedId = OrganizationIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const result = await this.organizationService.getByIdWithDetails(parsedId.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
export const organizationAdminController = wrapService(
  new OrganizationAdminController(new OrganizationService(createClient)),
  'organization-admin.controller',
);
