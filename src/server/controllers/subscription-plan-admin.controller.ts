import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreateSubscriptionPlanSchema,
  SubscriptionPlanIdParamsSchema,
  UpdateSubscriptionPlanSchema,
} from '@/server/models';
import { subscriptionPlanService } from '@/server/services';

export class SubscriptionPlanAdminController {
  async getAll(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = await subscriptionPlanService.getAllAdmin();
      return { success: true, statusCode: 200, data };
    });
  }

  async getById(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const data = await subscriptionPlanService.getById(parsedId.data.id);
      return { success: true, statusCode: 200, data };
    });
  }

  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreateSubscriptionPlanSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const data = await subscriptionPlanService.create(parsed.data);
      return { success: true, statusCode: 201, data };
    });
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      const parsed = UpdateSubscriptionPlanSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const data = await subscriptionPlanService.update(parsedId.data.id, parsed.data);
      return { success: true, statusCode: 200, data };
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }

      await subscriptionPlanService.delete(parsedId.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    });
  }
}

export const subscriptionPlanAdminController = new SubscriptionPlanAdminController();
