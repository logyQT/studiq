import { NextResponse } from "next/server";
import { authService } from "../services/auth.service";
import { RegisterSchema, LoginSchema } from "../models/user.model";

export class AuthController {
  async register(req: Request) {
    try {
      const body = await req.json();

      const validationResult = RegisterSchema.safeParse(body);

      if (!validationResult.success) {
        return NextResponse.json(
          {
            success: false,
            error: "ERROR_VALIDATION_FAILED",
            issues: validationResult.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }

      await authService.register(validationResult.data);

      // Zwracamy kod sukcesu (zapobiega enumeracji + wspiera i18n)
      return NextResponse.json(
        {
          success: true,
          message: "SUCCESS_ACTIVATION_LINK_SENT",
        },
        { status: 200 },
      );
    } catch (error: any) {
      return NextResponse.json({ success: false, error: "ERROR_INTERNAL_SERVER" }, { status: 500 });
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
            error: "ERROR_VALIDATION_FAILED",
            issues: validationResult.error.flatten().fieldErrors,
          },
          { status: 400 },
        );
      }

      const result = await authService.login(validationResult.data);
      return NextResponse.json({ success: true, data: result }, { status: 200 });
    } catch (error: any) {
      // error.message przechwytuje 'ERROR_INVALID_CREDENTIALS' z serwisu
      return NextResponse.json({ success: false, error: error.message || "ERROR_LOGIN_FAILED" }, { status: 401 });
    }
  }
}

export const authController = new AuthController();
