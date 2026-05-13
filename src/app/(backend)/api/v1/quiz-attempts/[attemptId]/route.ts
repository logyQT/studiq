import { NextRequest } from 'next/server';
import { quizAttemptController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { attemptId } = await params;
  const response = await quizAttemptController.getDetails(attemptId, user.id);
  return toNextResponse(response);
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const { attemptId } = await params;
  const body = await req.json();
  const response = await quizAttemptController.submit(body, attemptId, user.id);
  return toNextResponse(response);
}
