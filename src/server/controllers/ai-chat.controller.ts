import type { RequestContext } from '@/lib/request-context';
import { ChatRequestSchema } from '@/server/models/ai-chat.model';
import { chatService } from '@/server/services/ai-chat.service';

export interface ChatStreamCallbacks {
  onToken: (text: string) => void;
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

    await chatService.chat(text, file, messages, conversationId, ctx, {
      onToken: (token) => callbacks.onToken(token),
      onResult: (type, data) => callbacks.onResult(type, data),
      onComplete: (summary) => {
        callbacks.onUsage({
          current: 0,
          limit: Infinity,
          plan: 'free',
          resetsAt: '',
        });
        callbacks.onComplete(summary);
      },
      onError: (message) => callbacks.onError(message),
    });
  }
}

export const chatController = new ChatController();
