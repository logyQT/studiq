import type { UIMessage } from 'ai';
import { convertToModelMessages, hasToolCall, stepCountIs, streamText } from 'ai';
import type { NextRequest } from 'next/server';
import { conversationStorage } from '@/lib/conversation-context';
import { toNextResponse } from '@/lib/http-utils';
import { log } from '@/lib/logger';
import { createClient } from '@/lib/supabase/server';
import { enqueueTrace } from '@/lib/trace-queue';
import { systemPrompt } from '@/server/agents/system';
import {
  askUserTool,
  createPlanTool,
  evaluateQualityTool,
  extractConceptsTool,
  fetchMaterialTool,
  finishTool,
  generateFlashcardsTool,
  webfetchTool,
} from '@/server/agents/tools/generic';
import { chatModel, providerName } from '@/server/ai/model';

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

  const reasoningEffort = process.env.LL_REASONING_EFFORT;

  log.api.info('streamText start', {
    metadata: {
      conversationId,
      messageCount: messages.length,
      lastRole: messages[messages.length - 1]?.role,
      tools:
        'create_plan,ask_user,fetch_material,webfetch,extract_concepts,evaluate_quality,generate_flashcards,finish',
      stopWhen: 'finish,ask_user,generate_flashcards,stepCountIs(30)',
      reasoningEffort: reasoningEffort ?? 'default',
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
      messages: await convertToModelMessages(messages as unknown as Array<Omit<UIMessage, 'id'>>),
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
      ...(reasoningEffort ? { providerOptions: { [providerName]: { reasoningEffort } } } : {}),

      experimental_onStepStart: ({ stepNumber, messages: stepMessages }) => {
        const lastMsg = stepMessages[stepMessages.length - 1];
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
            messageCount: stepMessages.length,
            lastRole: lastMsg?.role,
            promptPreview: String(preview ?? '').slice(-300),
          },
        });
      },

      onStepFinish: (step) => {
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
                toolInput: JSON.stringify(tc.input).slice(0, 500),
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

      onFinish: (result) => {
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
