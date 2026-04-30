import { NextRequest, NextResponse } from 'next/server';
import { authService } from '@/server/services';
import {
  RegisterSchema,
  LoginSchema,
  forgotPasswordSchema,
  updatePasswordSchema,
} from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';
import { z } from '@/lib/zod';

export class AuthController {
  async register(req: NextRequest) {
    try {
      const body = await req.json();
      const parsed = RegisterSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: AppErrorCode.VALIDATION_FAILED,
            issues: z.treeifyError(parsed.error),
          },
          { status: 400 },
        );
      }

      await authService.register(parsed.data);

      return NextResponse.json(
        { success: true, message: 'SUCCESS_ACTIVATION_LINK_SENT' },
        { status: 200 },
      );
    } catch (error) {
      return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
    }
  }

  async login(req: NextRequest) {
    try {
      const body = await req.json();
      const parsed = LoginSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: AppErrorCode.VALIDATION_FAILED,
            issues: z.treeifyError(parsed.error),
          },
          { status: 400 },
        );
      }

      const result = await authService.login(parsed.data);

      return NextResponse.json({ success: true, user: result.user }, { status: 200 });
    } catch (error) {
      return handleApiError(error, AppErrorCode.LOGIN_FAILED);
    }
  }

  async logout() {
    try {
      await authService.logout();
      return NextResponse.json({ success: true, message: 'SUCCESS_LOGOUT' }, { status: 200 });
    } catch (error) {
      return handleApiError(error, AppErrorCode.LOGOUT_FAILED);
    }
  }

  async requestPasswordResetHandler(req: NextRequest) {
    try {
      const body = await req.json();
      const parsed = forgotPasswordSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: AppErrorCode.VALIDATION_FAILED,
            issues: z.treeifyError(parsed.error),
          },
          { status: 400 },
        );
      }

      await authService.requestPasswordReset(parsed.data.email);

      return NextResponse.json(
        { success: true, message: 'SUCCESS_PASSWORD_RESET_REQUESTED' },
        { status: 200 },
      );
    } catch (error) {
      return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
    }
  }

  async updatePasswordHandler(req: NextRequest) {
    try {
      const body = await req.json();
      const parsed = updatePasswordSchema.safeParse(body);

      if (!parsed.success) {
        return NextResponse.json(
          {
            success: false,
            error: AppErrorCode.VALIDATION_FAILED,
            issues: z.treeifyError(parsed.error),
          },
          { status: 400 },
        );
      }

      await authService.updatePassword(parsed.data.password);

      return NextResponse.json(
        { success: true, message: 'SUCCESS_PASSWORD_UPDATED' },
        { status: 200 },
      );
    } catch (error) {
      return handleApiError(error, AppErrorCode.PASSWORD_UPDATE_FAILED);
    }
  }
}

export const authController = new AuthController();
