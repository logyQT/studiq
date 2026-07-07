import type { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';
import { CreatePlanFeatureSchema, PlanFeatureIdParamsSchema } from '@/server/models';
import { planFeatureService } from '@/server/services';

export class PlanFeatureController {
  async getAll(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const data = await planFeatureService.getAll();
      return { success: true, statusCode: 200, data };
    });
  }

  async create(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = CreatePlanFeatureSchema.safeParse(body);
      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }
      const data = await planFeatureService.create(parsed.data);
      return { success: true, statusCode: 201, data };
    });
  }

  async delete(id: string): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = PlanFeatureIdParamsSchema.safeParse({ id });
      if (!parsed.success) {
        return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
      }
      await planFeatureService.delete(parsed.data.id);
      return { success: true, statusCode: 200, data: { success: true } };
    });
  }
}

export const planFeatureController = new PlanFeatureController();
