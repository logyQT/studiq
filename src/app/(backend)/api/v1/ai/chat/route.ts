import { streamText, hasToolCall, stepCountIs } from 'ai';
import { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { toNextResponse } from '@/lib/http-utils';
import { chatModel } from '@/server/ai/model';
import { systemPrompt } from '@/server/agents/system';
import {
  createPlanTool,
  askUserTool,
  fetchMaterialTool,
  webfetchTool,
  extractConceptsTool,
  evaluateQualityTool,
  generateFlashcardsTool,
  finishTool,
} from '@/server/agents/tools/generic';
import type { RequestContext } from '@/lib/request-context';
import type { UserRole } from '@/types';

export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return toNextResponse({ success: false, statusCode: 401, error: 'UNAUTHORIZED' });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }

  const { messages } = body as { messages?: Array<Record<string, unknown>> };
  if (!messages?.length) {
    return toNextResponse({ success: false, statusCode: 400, error: 'BAD_REQUEST' });
  }

  const result = streamText({
    model: chatModel,
    system: systemPrompt,
    messages: messages as any,
    tools: {
      create_plan: createPlanTool,
      ask_user: askUserTool,
      fetch_material: fetchMaterialTool,
      webfetch: webfetchTool,
      extract_concepts: extractConceptsTool,
      evaluate_quality: evaluateQualityTool,
      generate_flashcards: generateFlashcardsTool,
      finish: finishTool,
    },
    stopWhen: [hasToolCall('finish'), hasToolCall('ask_user'), stepCountIs(30)],
  });

  return result.toUIMessageStreamResponse();
}
