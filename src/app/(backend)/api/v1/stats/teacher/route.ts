import { NextRequest } from 'next/server';
import { statsController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get('subjectId') || undefined;

  const response = await statsController.getTeacherStats(user.id, subjectId);
  return toNextResponse(response);
}
