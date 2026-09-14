import { type ControllerResponse, controllerResponse } from '@/lib/controller-response';
import { isFailure } from '@/lib/service-result';
import { CreatePlanFeatureSchema, PlanFeatureIdParamsSchema } from '@/server/models';
import type { PlanFeatureService } from '@/server/services/plan-feature.service';

export class PlanFeatureController {
  constructor(private planFeatureService: PlanFeatureService) {}

  async getAll(): Promise<ControllerResponse> {
    const data = await this.planFeatureService.getAll();

    if (isFailure(data)) {
      return controllerResponse.error(data.error);
    }

    return controllerResponse.success(data.data);
  }

  async create(body: unknown): Promise<ControllerResponse> {
    const parsed = CreatePlanFeatureSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const data = await this.planFeatureService.create(parsed.data);

    if (isFailure(data)) {
      return controllerResponse.error(data.error);
    }

    return controllerResponse.created(data.data);
  }

  async delete(id: string): Promise<ControllerResponse> {
    const parsed = PlanFeatureIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.planFeatureService.delete(parsed.data.id);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ success: true });
  }
}
