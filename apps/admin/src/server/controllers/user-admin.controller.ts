import {
  CreateUserSchema,
  ListUsersQuerySchema,
  UpdateUserAccountTypeSchema,
} from '@admin/server/models/user-admin.model';
import { type UserAdminService, userAdminService } from '@admin/server/services/user-admin.service';
import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';

export class UserAdminController {
  constructor(private userAdminService: UserAdminService) {}

  async list(query: unknown): Promise<ControllerResponse> {
    const parsed = ListUsersQuerySchema.safeParse(query);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.userAdminService.listUsers(parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async getById(id: string): Promise<ControllerResponse> {
    const result = await this.userAdminService.getUser(id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async create(body: unknown): Promise<ControllerResponse> {
    const parsed = CreateUserSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.userAdminService.createUser(parsed.data);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.created(result.data);
  }

  async updateAccountType(id: string, body: unknown): Promise<ControllerResponse> {
    const parsed = UpdateUserAccountTypeSchema.safeParse(body);
    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.userAdminService.updateAccountType(id, parsed.data.accountType);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async softDelete(id: string): Promise<ControllerResponse> {
    const result = await this.userAdminService.softDeleteUser(id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async restore(id: string): Promise<ControllerResponse> {
    const result = await this.userAdminService.restoreUser(id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async purgeNow(id: string): Promise<ControllerResponse> {
    const result = await this.userAdminService.purgeNow(id);
    if (isFailure(result)) return controllerResponse.error(result.error);
    return controllerResponse.success(result.data);
  }

  async purgeExpired(): Promise<ControllerResponse> {
    await this.userAdminService.purgeExpired();
    return controllerResponse.success({ success: true });
  }
}
export const userAdminController = wrapService(
  new UserAdminController(userAdminService),
  'user-admin.controller',
);
