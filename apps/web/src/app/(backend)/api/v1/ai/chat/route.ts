import { AccountType } from '@studiq/authz';
import { systemPrompt } from '@studiq/server/agents/system';
import { askUserTool } from '@studiq/server/agents/tools/generic/ask-user.tool';
import { createPlanTool } from '@studiq/server/agents/tools/generic/create-plan.tool';
import { evaluateQualityTool } from '@studiq/server/agents/tools/generic/evaluate-quality.tool';
import { extractConceptsTool } from '@studiq/server/agents/tools/generic/extract-concepts.tool';
import { fetchMaterialTool } from '@studiq/server/agents/tools/generic/fetch-material.tool';
import { finishTool } from '@studiq/server/agents/tools/generic/finish.tool';
import { generateFlashcardsTool } from '@studiq/server/agents/tools/generic/generate-flashcards.tool';
import { webfetchTool } from '@studiq/server/agents/tools/generic/webfetch.tool';
import { chatModel, providerName, reasoningEffort } from '@studiq/server/ai/model';
import { conversationStorage } from '@studiq/server/lib/conversation-context';
import { toNextResponse } from '@studiq/server/lib/http-utils';
import { enqueueTrace } from '@studiq/server/lib/trace-queue';
import { withAuth } from '@studiq/server/lib/with-auth';
import type { UIMessage } from 'ai';
import { convertToModelMessages, hasToolCall, stepCountIs, streamText } from 'ai';
import type { NextRequest } from 'next/server';

export async function POST(req: NextRequest) {
  return withAuth(
    req,
    async (ctx) => {
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

      return runAgentChat(ctx.userId, conversationId, messages);
    },
    { allowedAccountTypes: [AccountType.STUDENT, AccountType.EDUCATOR] },
  );
}

async function runAgentChat(
  _userId: string,
  conversationId: string,
  messages: Array<Record<string, unknown>>,
) {
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
      stopWhen: [hasToolCall('finish'), hasToolCall('ask_user'), stepCountIs(30)],
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
