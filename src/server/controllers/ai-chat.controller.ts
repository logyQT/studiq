import type { RequestContext } from '@/lib/request-context';
import { ChatRequestSchema } from '@/server/models/ai-chat.model';
import { chatService } from '@/server/services/ai-chat.service';
import { getUsage, trackTokenUsage } from '@/server/services/plan.resolver';

export interface ChatStreamCallbacks {
  onToken: (text: string) => void;
  onReasoning?: (token: string) => void;
  onResult: (type: string, data: unknown) => void;
  onComplete: (summary: string) => void;
  onUsage: (usage: { current: number; limit: number; plan: string; resetsAt: string }) => void;
  onError: (message: string) => void;
}

export class ChatController {
  async chat(body: unknown, ctx: RequestContext, callbacks: ChatStreamCallbacks): Promise<void> {
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      callbacks.onError('Invalid request body');
      return;
    }

    const { text, file, messages, conversationId } = parsed.data;

    // Check token budget before starting
    const usage = await getUsage(ctx, 'max_ai_tokens_per_day');
    callbacks.onUsage(usage);

    if (usage.limit !== -1 && usage.current >= usage.limit) {
      callbacks.onError('Daily AI token limit reached. Upgrade your plan for more.');
      return;
    }

    await chatService.chat(text, file, messages, conversationId, ctx, {
      onToken: (token) => callbacks.onToken(token),
      onReasoning: (token) => callbacks.onReasoning?.(token),
      onResult: (type, data) => callbacks.onResult(type, data),
      onComplete: (summary, tokenUsage) => {
        // Track actual token usage after completion
        if (tokenUsage) {
          trackTokenUsage(ctx, tokenUsage.inputTokens ?? 0, tokenUsage.outputTokens ?? 0);
        }
        callbacks.onComplete(summary);
      },
      onError: (message) => callbacks.onError(message),
    });
  }
}

export const chatController = new ChatController();
