import type { ControllerResponse } from '@/lib/controller-response';
import { controllerResponse } from '@/lib/controller-response';
import { isFailure } from '@/lib/service-result';
import {
  CreateUserFeatureOverrideSchema,
  UpdateUserFeatureOverrideSchema,
  UserFeatureOverrideIdParamsSchema,
} from '@/server/models';
import type { UserOverrideService } from '@/server/services/user-override.service';

export class UserOverrideController {
  constructor(private userOverrideService: UserOverrideService) {}

  async getAll(): Promise<ControllerResponse> {
    const result = await this.userOverrideService.getAll();
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const parsed = UserFeatureOverrideIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const result = await this.userOverrideService.getById(parsed.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async create(body: unknown): Promise<ControllerResponse> {
    const parsed = CreateUserFeatureOverrideSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }
    const result = await this.userOverrideService.create(parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async update(id: string, body: unknown): Promise<ControllerResponse> {
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
    const result = await this.userOverrideService.update(parsedId.data.id, parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async delete(id: string): Promise<ControllerResponse> {
    const parsed = UserFeatureOverrideIdParamsSchema.safeParse({ id });
    if (!parsed.success) {
      return { success: false, statusCode: 400, error: 'BAD_REQUEST' };
    }
    const result = await this.userOverrideService.delete(parsed.data.id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return { success: true, statusCode: 200, data: { success: true } };
  }
}
