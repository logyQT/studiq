import { callLLMStreaming } from '@/server/ai';
import { pdfService } from '@/server/services/pdf.service';
import type { RequestContext } from '@/lib/request-context';
import type { TokenUsage } from '@/server/ai/ai.types';
import type { ChatMessageInput } from '@/server/models/ai-chat.model';

const LOG_PREFIX = '[ChatService]';

export interface ChatServiceCallbacks {
  onToken: (token: string) => void;
  onResult: (type: string, data: unknown) => void;
  onComplete: (summary: string, usage?: TokenUsage) => void;
  onError: (message: string) => void;
}

const SYSTEM_PROMPT = `You are StudiQ AI, an expert educational assistant. Help the user learn by answering questions, explaining concepts, and creating study materials. Respond conversationally, clearly, and in a structured way. Use bullet points, headings, and examples where appropriate. If the user asks in Polish, respond in Polish. If they ask in English, respond in English.`;

export class ChatService {
  async chat(
    text: string,
    file: { data: string; mimeType: string } | undefined,
    messages: ChatMessageInput[] | undefined,
    ctx: RequestContext,
    callbacks: ChatServiceCallbacks,
  ): Promise<void> {
    try {
      let prompt = text;
      if (messages && messages.length > 0) {
        const history = messages
          .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');
        prompt = `Previous conversation:\n${history}\n\nUser: ${text}`;
      }
      let systemPrompt = SYSTEM_PROMPT;

      if (file) {
        let extracted = '';
        try {
          if (file.mimeType === 'application/pdf') {
            const buffer = Buffer.from(file.data, 'base64');
            extracted = await pdfService.extractText(buffer);
            extracted = extracted.slice(0, 15000);
          } else if (file.mimeType === 'text/plain') {
            extracted = Buffer.from(file.data, 'base64').toString('utf-8').slice(0, 15000);
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          console.error(`${LOG_PREFIX} File extraction failed:`, error);
          callbacks.onError(`Failed to extract file content: ${msg}`);
          return;
        }

        if (extracted) {
          systemPrompt = `${SYSTEM_PROMPT}\n\nThe user has attached a file with the following content:\n\n${extracted}\n\nUse the file content to answer the user's questions.`;
        }
      }

      const response = await callLLMStreaming(
        {
          prompt,
          systemPrompt,
          responseFormat: 'text',
        },
        ctx,
        { onToken: (token) => callbacks.onToken(token) },
      );

      callbacks.onComplete(response.content, response.usage);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error';
      console.error(`${LOG_PREFIX} Chat failed:`, error);
      callbacks.onError(msg);
    }
  }
}

export const chatService = new ChatService();
