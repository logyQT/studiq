import { authService } from '@/server/services';
import {
  RegisterSchema,
  LoginSchema,
  forgotPasswordSchema,
  updatePasswordSchema,
} from '@/server/models';
import { AppError } from '@/lib/errors';
import { ControllerResponse } from '@/lib/controller-response';

export class AuthController {
  async register(body: unknown): Promise<ControllerResponse> {
    try {
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

      return { success: true, statusCode: 200, data: { message: 'SUCCESS_ACTIVATION_LINK_SENT' } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async login(body: unknown): Promise<ControllerResponse> {
    try {
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

      return { success: true, statusCode: 200, data: { user: result.user } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async logout(): Promise<ControllerResponse> {
    try {
      await authService.logout();
      return { success: true, statusCode: 200, data: { message: 'SUCCESS_LOGOUT' } };
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async requestPasswordReset(body: unknown): Promise<ControllerResponse> {
    try {
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
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }

  async updatePassword(body: unknown): Promise<ControllerResponse> {
    try {
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
    } catch (error) {
      if (error instanceof AppError) {
        return { success: false, statusCode: error.statusCode, error: error.code };
      }
      return { success: false, statusCode: 500, error: 'INTERNAL_SERVER' };
    }
  }
}

export const authController = new AuthController();
