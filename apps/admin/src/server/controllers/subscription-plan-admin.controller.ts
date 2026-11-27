import { createClient } from '@admin/lib/supabase/admin-client';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure, success, type ServiceResult } from '@studiq/server/lib/service-result';
import {
  AssignPlanOrganizationSchema,
  CreateSubscriptionPlanSchema,
  PlanAssignmentParamsSchema,
  SubscriptionPlanIdParamsSchema,
  UpdateSubscriptionPlanSchema,
} from '@studiq/server/models/subscription-plan.model';
import { SubscriptionPlanService } from '@studiq/server/services/subscription-plan.service';

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

  /**
   * The plan key is the assignment key, and the route names the plan by id, so
   * every assignment handler resolves the plan first. The id parse stays
   * separate from the lookup: an invalid id is `BAD_REQUEST`, a missing plan
   * `NOT_FOUND`, and a database failure keeps its own code.
   */
  private async planKeyOf(id: string): Promise<ServiceResult<{ key: string }>> {
    const plan = await this.subscriptionPlanService.getById(id);
    if (isFailure(plan)) return plan;
    return success({ key: plan.data.key });
  }

  async getAssignments(id: string): Promise<ControllerResponse> {
    const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const plan = await this.planKeyOf(parsedId.data.id);
    if (isFailure(plan)) return controllerResponse.error(plan.error);

    const result = await this.subscriptionPlanService.listAssignments(plan.data.key);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async assign(id: string, body: unknown): Promise<ControllerResponse> {
    const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const parsed = AssignPlanOrganizationSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const plan = await this.planKeyOf(parsedId.data.id);
    if (isFailure(plan)) return controllerResponse.error(plan.error);

    const result = await this.subscriptionPlanService.assignOrganization(
      plan.data.key,
      parsed.data.organizationId,
    );
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async unassign(id: string, organizationId: string): Promise<ControllerResponse> {
    const parsedId = SubscriptionPlanIdParamsSchema.safeParse({ id });
    if (!parsedId.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }

    const parsed = PlanAssignmentParamsSchema.safeParse({ organizationId });
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 400,
        error: 'BAD_REQUEST',
        details: parsed.error.issues,
      };
    }

    const plan = await this.planKeyOf(parsedId.data.id);
    if (isFailure(plan)) return controllerResponse.error(plan.error);

    const result = await this.subscriptionPlanService.unassignOrganization(
      plan.data.key,
      parsed.data.organizationId,
    );
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }
}
export const subscriptionPlanAdminController = wrapService(
  new SubscriptionPlanAdminController(new SubscriptionPlanService(createClient)),
  'subscription-plan-admin.controller',
);
