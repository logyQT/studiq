import {
  CreateFeatureFlagSchema,
  FeatureFlagIdParamsSchema,
  UpdateFeatureFlagSchema,
} from '@admin/server/models/feature-flag.model';
import {
  type FeatureFlagService,
  featureFlagService,
} from '@admin/server/services/feature-flag.service';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';

export class FeatureFlagController {
  constructor(private featureFlagService: FeatureFlagService) {}

  async getAll(): Promise<ControllerResponse> {
    const result = await this.featureFlagService.getAll();
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const parsed = FeatureFlagIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const result = await this.featureFlagService.getById(parsed.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async create(body: unknown): Promise<ControllerResponse> {
    const parsed = CreateFeatureFlagSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.featureFlagService.create(parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
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
    const result = await this.featureFlagService.update(parsedId.data.id, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async delete(id: string): Promise<ControllerResponse> {
    const parsed = FeatureFlagIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const result = await this.featureFlagService.delete(parsed.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return { success: true, statusCode: 200, data: { success: true } };
  }
}
export const featureFlagController = wrapService(
  new FeatureFlagController(featureFlagService),
  'feature-flag.controller',
);
