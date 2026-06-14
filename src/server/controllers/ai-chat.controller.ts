import { ChatRequestSchema } from '@/server/models/ai-chat.model';
import { chatService } from '@/server/services/ai-chat.service';
import { checkSubscription, checkUsage } from '@/server/guards';
import type { RequestContext } from '@/lib/request-context';

export interface ChatStreamCallbacks {
  onToken: (text: string) => void;
  onResult: (type: string, data: unknown) => void;
  onComplete: (summary: string) => void;
  onUsage: (usage: { current: number; limit: number; plan: string; resetsAt: string }) => void;
  onError: (message: string) => void;
}

export class ChatController {
  async chat(
    body: unknown,
    ctx: RequestContext,
    callbacks: ChatStreamCallbacks,
  ): Promise<void> {
    const parsed = ChatRequestSchema.safeParse(body);
    if (!parsed.success) {
      callbacks.onError('Invalid request body');
      return;
    }

    const subResult = await checkSubscription(ctx.userId);
    if (!subResult.allowed) {
      callbacks.onError(subResult.reason || 'Subscription check failed');
      return;
    }

    const usageResult = await checkUsage(ctx.userId, 'chat', subResult.plan);
    if (!usageResult.allowed) {
      callbacks.onUsage({
        current: usageResult.current.daily,
        limit: usageResult.limits.daily,
        plan: subResult.plan?.name || 'unknown',
        resetsAt: usageResult.resetsAt.daily,
      });
      callbacks.onError('Usage limit exceeded');
      return;
    }

    const { text, file } = parsed.data;

    await chatService.chat(text, file, ctx, {
      onToken: (token) => callbacks.onToken(token),
      onResult: (type, data) => callbacks.onResult(type, data),
      onComplete: (summary, usage) => {
        if (usage) {
          callbacks.onUsage({
            current: usageResult.current.daily + 1,
            limit: usageResult.limits.daily,
            plan: subResult.plan?.name || 'unknown',
            resetsAt: usageResult.resetsAt.daily,
          });
        }
        callbacks.onComplete(summary);
      },
      onError: (message) => callbacks.onError(message),
    });
  }
}

export const chatController = new ChatController();
