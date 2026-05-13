import { NextRequest } from 'next/server';
import { flashcardController } from '@/server/controllers';
import { toNextResponse } from '@/lib/http-utils';
import { createClient } from '@/lib/supabase/server';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await flashcardController.create(body, user.id);
  return toNextResponse(response);
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const topicIds = searchParams.get('topicIds')?.split(',').filter(Boolean);
  const spaceIds = searchParams.get('spaceIds')?.split(',').filter(Boolean);
  const filters: { topicIds?: string[]; spaceIds?: string[] } = {};
  if (topicIds && topicIds.length > 0) filters.topicIds = topicIds;
  if (spaceIds && spaceIds.length > 0) filters.spaceIds = spaceIds;

  const response = await flashcardController.list(
    Object.keys(filters).length > 0 ? filters : undefined,
  );
  return toNextResponse(response);
}

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  const body = await req.json();
  const response = await flashcardController.bulkCreate(body, user.id);
  return toNextResponse(response);
}
