import { NextRequest } from 'next/server';
import { questionController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await questionController.create(body, user.id);
  return toNextResponse(response);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const subjectId = searchParams.get('subjectId') || undefined;
  const type = searchParams.get('type') || undefined;
  const difficulty = searchParams.get('difficulty') || undefined;

  const filters: { subjectId?: string; type?: string; difficulty?: string } = {};
  if (subjectId) filters.subjectId = subjectId;
  if (type) filters.type = type;
  if (difficulty) filters.difficulty = difficulty;

  const response = await questionController.list(Object.keys(filters).length > 0 ? filters : undefined);
  return toNextResponse(response);
}
