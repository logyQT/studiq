import type { ControllerResponse } from '@studiq/server/lib/controller-response';
import { controllerResponse } from '@studiq/server/lib/controller-response';
import { wrapService } from '@studiq/server/lib/observability';
import { isFailure } from '@studiq/server/lib/service-result';
import {
  forgotPasswordSchema,
  LoginSchema,
  RegisterSchema,
  UpdateProfileSchema,
  updatePasswordSchema,
} from '@studiq/server/models/auth.model';
import { type AuthService, authService } from '@studiq/server/services/auth.service';

export class AuthController {
  constructor(private authService: AuthService) {}

  async register(body: unknown): Promise<ControllerResponse> {
    const parsed = RegisterSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.authService.register(parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ message: 'SUCCESS_ACTIVATION_LINK_SENT' }, 202);
  }

  async login(body: unknown): Promise<ControllerResponse> {
    const parsed = LoginSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.authService.login(parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ user: result.data.user, session: result.data.session });
  }

  async logout(): Promise<ControllerResponse> {
    const result = await this.authService.logout();

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ message: 'SUCCESS_LOGOUT' });
  }

  async requestPasswordReset(body: unknown): Promise<ControllerResponse> {
    const parsed = forgotPasswordSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.authService.requestPasswordReset(parsed.data.email);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ message: 'SUCCESS_PASSWORD_RESET_REQUESTED' });
  }

  async updateProfile(body: unknown): Promise<ControllerResponse> {
    const parsed = UpdateProfileSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.authService.updateProfile(parsed.data);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ user: result.data });
  }

  async updatePassword(body: unknown): Promise<ControllerResponse> {
    const parsed = updatePasswordSchema.safeParse(body);

    if (!parsed.success) {
      return {
        success: false,
        statusCode: 422,
        error: 'UNPROCESSABLE_ENTITY',
        details: parsed.error.issues,
      };
    }

    const result = await this.authService.updatePassword(parsed.data.password);

    if (isFailure(result)) {
      return controllerResponse.error(result.error);
    }

    return controllerResponse.success({ message: 'SUCCESS_PASSWORD_UPDATED' });
  }
}
export const authController = wrapService(new AuthController(authService), 'auth.controller');
