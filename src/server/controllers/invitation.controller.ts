import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { CreateInviteSchema } from '@/server/models';
import { invitationService } from '@/server/services';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export class InvitationController {
  async create(req: NextRequest): Promise<NextResponse> {
    try {
      const body = (await req.json()) as unknown;

      const parsedData = CreateInviteSchema.parse(body);

      const result = await invitationService.createInvitation(parsedData);

      return NextResponse.json(result, { status: 201 });
    } catch (error: unknown) {
      if (error instanceof z.ZodError) {
        return NextResponse.json(
          {
            success: false,
            error: AppErrorCode.VALIDATION_FAILED,
            details: error.issues,
          },
          { status: 400 },
        );
      }

      return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
    }
  }

  async getByToken(req: NextRequest): Promise<NextResponse> {
    try {
      const { searchParams } = new URL(req.url);
      const token = searchParams.get('token');

      if (!token) {
        return NextResponse.json({ success: false, error: 'MISSING_TOKEN' }, { status: 400 });
      }

      const invitation = await invitationService.getInvitationByToken(token);
      return NextResponse.json({ success: true, data: invitation });
    } catch (error) {
      return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
    }
  }
}

export const invitationController = new InvitationController();
