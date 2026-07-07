import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreateFeatureFlagSchema,
  FeatureFlagIdParamsSchema,
  UpdateFeatureFlagSchema,
} from '@/server/models';
import { featureFlagService } from '@/server/services';

export class FeatureFlagController {
  async getAll(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = await featureFlagService.getAll();
      return { success: true, statusCode: 200, data };
    });
  }

  async getById(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = FeatureFlagIdParamsSchema.safeParse({ id });
      if (!parsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      const data = await featureFlagService.getById(parsed.data.id);
      return { success: true, statusCode: 200, data };
    });
  }

  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateFeatureFlagSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await featureFlagService.create(parsed.data);
      return { success: true, statusCode: 201, data };
    });
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = FeatureFlagIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      const parsed = UpdateFeatureFlagSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await featureFlagService.update(parsedId.data.id, parsed.data);
      return { success: true, statusCode: 200, data };
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = FeatureFlagIdParamsSchema.safeParse({ id });
      if (!parsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      await featureFlagService.delete(parsed.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    });
  }
}

export const featureFlagController = new FeatureFlagController();
