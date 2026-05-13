import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { invitationController } from '@/server/controllers/invitation.controller';
import { toNextResponse } from '@/lib/http-utils';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await invitationController.createBulk(user.id, body);
  return toNextResponse(response);
}
