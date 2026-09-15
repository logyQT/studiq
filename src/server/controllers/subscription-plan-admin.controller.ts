import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { wrapService } from '@/lib/observability';
import { isFailure } from '@/lib/service-result';
import {
  CreateSubscriptionPlanSchema,
  SubscriptionPlanIdParamsSchema,
  UpdateSubscriptionPlanSchema,
} from '@/server/models/subscription-plan.model';
import {
  type SubscriptionPlanService,
  subscriptionPlanService,
} from '@/server/services/subscription-plan.service';

export class SubscriptionPlanAdminController {
  constructor(private subscriptionPlanService: SubscriptionPlanService) {}

  async getAll(): Promise<ControllerResponse> {
    const result = await this.subscriptionPlanService.getAllAdmin();
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.subscriptionPlanService.getById(parsedId.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async create(body: unknown): Promise<ControllerResponse> {
    const parsed = CreateSubscriptionPlanSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.subscriptionPlanService.create(parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
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

    const result = await this.subscriptionPlanService.update(parsedId.data.id, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async delete(id: string): Promise<ControllerResponse> {
    const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const result = await this.subscriptionPlanService.delete(parsedId.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return { success: true, statusCode: 200, data: { success: true } };
  }
}
export const subscriptionPlanAdminController = wrapService(
  new SubscriptionPlanAdminController(subscriptionPlanService),
  'subscription-plan-admin.controller',
);
