import { authService } from '@/server/services';
import {
  RegisterSchema,
  LoginSchema,
  forgotPasswordSchema,
  updatePasswordSchema,
} from '@/server/models';
import { ControllerResponse } from '@/lib/controller-response';
import { withErrorHandling } from '@/lib/with-error-handling';

export class AuthController {
  async register(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = RegisterSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await authService.register(parsed.data);

      return { success: true, statusCode: 202, data: { message: 'SUCCESS_ACTIVATION_LINK_SENT' } };
    });
  }

  async login(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = LoginSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      const result = await authService.login(parsed.data);

      return { success: true, statusCode: 200, data: { user: result.user, session: result.session } };
    });
  }

  async logout(): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      await authService.logout();
      return { success: true, statusCode: 200, data: { message: 'SUCCESS_LOGOUT' } };
    });
  }

  async requestPasswordReset(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = forgotPasswordSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await authService.requestPasswordReset(parsed.data.email);

      return {
        success: true,
        statusCode: 200,
        data: { message: 'SUCCESS_PASSWORD_RESET_REQUESTED' },
      };
    });
  }

  async updatePassword(body: unknown): Promise<ControllerResponse> {
    return withErrorHandling(async () => {
      const parsed = updatePasswordSchema.safeParse(body);

      if (!parsed.success) {
        return {
          success: false,
          statusCode: 422,
          error: 'UNPROCESSABLE_ENTITY',
          details: parsed.error.issues,
        };
      }

      await authService.updatePassword(parsed.data.password);

      return { success: true, statusCode: 200, data: { message: 'SUCCESS_PASSWORD_UPDATED' } };
    });
  }
}

export const authController = new AuthController();
