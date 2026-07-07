import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreateUserFeatureOverrideSchema,
  UpdateUserFeatureOverrideSchema,
  UserFeatureOverrideIdParamsSchema,
} from '@/server/models';
import { userOverrideService } from '@/server/services';

export class UserOverrideController {
  async getAll(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = await userOverrideService.getAll();
      return { success: true, statusCode: 200, data };
    });
  }

  async getById(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UserFeatureOverrideIdParamsSchema.safeParse({ id });
      if (!parsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      const data = await userOverrideService.getById(parsed.data.id);
      return { success: true, statusCode: 200, data };
    });
  }

  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateUserFeatureOverrideSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await userOverrideService.create(parsed.data);
      return { success: true, statusCode: 201, data };
    });
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = UserFeatureOverrideIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      const parsed = UpdateUserFeatureOverrideSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await userOverrideService.update(parsedId.data.id, parsed.data);
      return { success: true, statusCode: 200, data };
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = UserFeatureOverrideIdParamsSchema.safeParse({ id });
      if (!parsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      await userOverrideService.delete(parsed.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    });
  }
}

export const userOverrideController = new UserOverrideController();
