import { streamText, hasToolCall, stepCountIs, convertToModelMessages } from 'ai';
import { NextRequest } from 'next/server';
import { log } from '@/lib/logger';
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
import { conversationStorage } from '@/lib/conversation-context';
import { enqueueTrace } from '@/lib/trace-queue';

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

  const conversationId =
    ((messages[0] as Record<string, unknown>)?.id as string) || crypto.randomUUID();

  log.api.info('streamText start', {
    metadata: {
      conversationId,
      messageCount: messages.length,
      lastRole: messages[messages.length - 1]?.role,
      tools:
        'create_plan,ask_user,fetch_material,webfetch,extract_concepts,evaluate_quality,generate_flashcards,finish',
      stopWhen: 'finish,ask_user,generate_flashcards,stepCountIs(30)',
    },
  });

  enqueueTrace({
    conversationId,
    agentName: 'general',
    eventType: 'step',
    label: 'streamText start',
    data: { messageCount: messages.length, lastRole: messages[messages.length - 1]?.role },
  });

  return conversationStorage.run({ conversationId }, async () => {
    const result = streamText({
      model: chatModel,
      system: systemPrompt,
      messages: await convertToModelMessages(messages as any),
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
      stopWhen: [
        hasToolCall('finish'),
        hasToolCall('ask_user'),
        hasToolCall('generate_flashcards'),
        stepCountIs(30),
      ],

      experimental_onStepStart: ({
        stepNumber,
        messages,
      }: {
        stepNumber: number;
        messages: Array<Record<string, unknown>>;
      }) => {
        const lastMsg = messages[messages.length - 1];
        const raw = lastMsg?.content;
        const preview =
          typeof raw === 'string' ? raw : Array.isArray(raw) ? JSON.stringify(raw[0]) : '';
        enqueueTrace({
          conversationId,
          agentName: 'general',
          eventType: 'step',
          label: `step ${stepNumber} start`,
          data: {
            stepNumber,
            messageCount: messages.length,
            lastRole: lastMsg?.role,
            promptPreview: String(preview ?? '').slice(-300),
          },
        });
      },

      onStepFinish: (step: any) => {
        if (step.toolCalls?.length) {
          for (const tc of step.toolCalls) {
            enqueueTrace({
              conversationId,
              agentName: 'general',
              eventType: 'tool_call',
              label: `step ${step.stepNumber} tool: ${tc.toolName}`,
              data: {
                stepNumber: step.stepNumber,
                toolName: tc.toolName,
                toolInput: JSON.stringify(tc.args).slice(0, 500),
                inputTokens: step.usage?.inputTokens,
                outputTokens: step.usage?.outputTokens,
                totalTokens: step.usage?.totalTokens,
                finishReason: step.finishReason,
              },
            });
          }
        } else {
          enqueueTrace({
            conversationId,
            agentName: 'general',
            eventType: 'step',
            label: `step ${step.stepNumber} response`,
            data: {
              stepNumber: step.stepNumber,
              textLength: step.text?.length ?? 0,
              reasoningLength: step.reasoningText?.length ?? 0,
              inputTokens: step.usage?.inputTokens,
              outputTokens: step.usage?.outputTokens,
              totalTokens: step.usage?.totalTokens,
              finishReason: step.finishReason,
            },
          });
        }
      },

      onFinish: (result: any) => {
        enqueueTrace({
          conversationId,
          agentName: 'general',
          eventType: 'step',
          label: 'streamText finish',
          data: {
            totalSteps: result.steps?.length ?? 0,
            totalInputTokens: result.totalUsage?.inputTokens,
            totalOutputTokens: result.totalUsage?.outputTokens,
            totalTokens: result.totalUsage?.totalTokens,
            finishReason: result.finishReason,
            finalTextLength: result.text?.length ?? 0,
          },
        });
      },
    });

    return result.toUIMessageStreamResponse();
  });
}
