import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreateOrganizationSchema,
  OrganizationIdParamsSchema,
  UpdateOrganizationSchema,
} from '@/server/models';
import { organizationService } from '@/server/services';

export class OrganizationController {
  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedData = CreateOrganizationSchema.safeParse(body);

      if (!parsedData.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsedData.error.issues,
        };
      }

      const result = await organizationService.create(parsedData.data);

      return { success: true, statusCode: 201, data: result };
    });
  }

  async getAll(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const organizations = await organizationService.getAll();
      return { success: true, statusCode: 200, data: organizations };
    });
  }

  async getById(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = OrganizationIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return {
          success: false,
          statusCode: 400,
          error: 'BAD_REQUEST',
        };
      }

      const organization = await organizationService.getById(parsedId.data.id);
      return { success: true, statusCode: 200, data: organization };
    });
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = OrganizationIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return {
          success: false,
          statusCode: 400,
          error: 'BAD_REQUEST',
        };
      }

      const parsedData = UpdateOrganizationSchema.safeParse(body);
      if (!parsedData.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsedData.error.issues,
        };
      }

      const result = await organizationService.update(parsedId.data.id, parsedData.data);
      return { success: true, statusCode: 200, data: result };
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = OrganizationIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return {
          success: false,
          statusCode: 400,
          error: 'BAD_REQUEST',
        };
      }

      await organizationService.delete(parsedId.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    });
  }
}

export const organizationController = new OrganizationController();
