import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import {
  CreatePlanLimitSchema,
  PlanLimitIdParamsSchema,
  UpdatePlanLimitSchema,
} from '@/server/models';
import { planLimitService } from '@/server/services';

export class PlanLimitController {
  async getAll(planKey?: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = planKey
        ? await planLimitService.getByPlanKey(planKey)
        : await planLimitService.getAll();
      return { success: true, statusCode: 200, data };
    });
  }

  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreatePlanLimitSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await planLimitService.create(parsed.data);
      return { success: true, statusCode: 201, data };
    });
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsedId = PlanLimitIdParamsSchema.safeParse({ id });
      if (!parsedId.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      const parsed = UpdatePlanLimitSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await planLimitService.update(parsedId.data.id, parsed.data);
      return { success: true, statusCode: 200, data };
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = PlanLimitIdParamsSchema.safeParse({ id });
      if (!parsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      await planLimitService.delete(parsed.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    });
  }
}

export const planLimitController = new PlanLimitController();
