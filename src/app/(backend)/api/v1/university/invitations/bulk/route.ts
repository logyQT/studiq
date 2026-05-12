import { NextRequest, NextResponse } from 'next/server';
import { invitationService } from '@/server/services';
import { CreateInviteSchema } from '@/server/models';
import { AppErrorCode, handleApiError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { invitations } = body;

    if (!Array.isArray(invitations) || invitations.length === 0) {
      return NextResponse.json(
        { success: false, error: AppErrorCode.INVALID_INPUT },
        { status: 400 },
      );
    }

    const results = [];
    for (const invite of invitations) {
      const parsed = CreateInviteSchema.safeParse(invite);
      if (!parsed.success) {
        results.push({ success: false, error: parsed.error.issues });
        continue;
      }
      try {
        const result = await invitationService.createInvitation(parsed.data);
        results.push({ success: true, data: result });
      } catch {
        results.push({ success: false, error: 'Failed to create invitation' });
      }
    }

    return NextResponse.json({ results });
  } catch (error) {
    return handleApiError(error, AppErrorCode.INTERNAL_SERVER);
  }
}
