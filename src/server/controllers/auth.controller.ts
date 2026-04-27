import { NextResponse } from 'next/server';
import { authService } from '@/server/services';
import { RegisterSchema, LoginSchema } from '@/server/models';

export class AuthController {
  async register(req: Request) {
    try {
      const body = await req.json();

      const validationResult = RegisterSchema.safeParse(body);

      if (!validationResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: 'ERROR_VALIDATION_FAILED',
            issues: validationResult.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }

      await authService.register(validationResult.data);

      return NextResponse.json(
        {
          success: true,
          message: 'SUCCESS_ACTIVATION_LINK_SENT',
        },
        { status: 200 },
      );
    } catch (error: any) {
      return NextResponse.json({ success: false, error: 'ERROR_INTERNAL_SERVER' }, { status: 500 });
    }
  }

  async login(req: Request) {
    try {
      const body = await req.json();
      const validationResult = LoginSchema.safeParse(body);

      if (!validationResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: 'ERROR_VALIDATION_FAILED',
            issues: validationResult.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }

      const result = await authService.login(validationResult.data);

      return NextResponse.json({ success: true, user: result.user }, { status: 200 });
    } catch (error: any) {
      return NextResponse.json(
        { success: false, error: error.message || 'ERROR_LOGIN_FAILED' },
        { status: 401 },
      );
    }
  }

  async logout() {
    try {
      await authService.logout();

      return NextResponse.json(
        {
          success: true,
          message: 'SUCCESS_LOGOUT',
        },
        { status: 200 },
      );
    } catch (error: any) {
      return NextResponse.json({ success: false, error: 'ERROR_LOGOUT_FAILED' }, { status: 500 });
    }
  }
}

export const authController = new AuthController();
