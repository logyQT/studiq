import { log } from '@/lib/logger';
import { chatModel } from '@/server/ai/model';
import { pdfService } from '@/server/services/pdf.service';
import { pdfCacheService } from '@/server/services/pdf-cache.service';
import type { RequestContext } from '@/lib/request-context';
import type { TokenUsage } from '@/server/ai/ai.types';
import type { ChatMessageInput } from '@/server/models/ai-chat.model';
import { streamText } from 'ai';

const MAX_FILE_CHARS = parseInt(process.env.LLM_MAX_FILE_CHARS || '200000', 10);

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
    conversationId: string | undefined,
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

      // Resolve file content: either from new upload or from cache
      let extracted = '';

      if (file) {
        try {
          if (file.mimeType === 'application/pdf') {
            const buffer = Buffer.from(file.data, 'base64');
            extracted = await pdfService.extractText(buffer);
            log.ai.info(`PDF extracted ${extracted.length} chars`);
          } else if (file.mimeType === 'text/plain') {
            extracted = Buffer.from(file.data, 'base64').toString('utf-8');
          }
        } catch (error) {
          const msg = error instanceof Error ? error.message : 'Unknown error';
          log.ai.error('File extraction failed', { metadata: { error } });
          callbacks.onError(`Failed to extract file content: ${msg}`);
          return;
        }

        // Truncate to configurable limit
        if (extracted.length > MAX_FILE_CHARS) {
          log.ai.warn(`Truncating file content from ${extracted.length} to ${MAX_FILE_CHARS} chars`);
          extracted = extracted.slice(0, MAX_FILE_CHARS);
        }

        // Cache extracted text for conversation persistence
        if (conversationId && extracted) {
          pdfCacheService.set(conversationId, extracted, file.mimeType);
        }
      } else if (conversationId) {
        // No new file — try to retrieve cached text for this conversation
        const cached = pdfCacheService.get(conversationId);
        if (cached) {
          extracted = cached.text;
          log.ai.info(`Retrieved ${extracted.length} chars from cache for conversation ${conversationId}`);
        }
      }

      if (extracted) {
        systemPrompt = `${SYSTEM_PROMPT}\n\nThe user has attached a file with the following content:\n\n${extracted}\n\nUse the file content to answer the user's questions.`;
      }

      const result = streamText({
        model: chatModel,
        system: systemPrompt,
        prompt,
        maxRetries: 3,
        onChunk: ({ chunk }: { chunk: { type: string; textDelta?: string } }) => {
          if (chunk.type === 'text-delta' && chunk.textDelta) {
            callbacks.onToken(chunk.textDelta);
          }
        },
      });

      const content = await result.text;
      const resolvedUsage = await result.usage;
      const mappedUsage: TokenUsage | undefined = resolvedUsage
        ? {
            inputTokens: resolvedUsage.inputTokens ?? 0,
            outputTokens: resolvedUsage.outputTokens ?? 0,
            totalTokens: resolvedUsage.totalTokens ?? 0,
            provider: 'opencode',
            model: 'mimo-v2.5',
          }
        : undefined;

      callbacks.onComplete(content, mappedUsage);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Internal server error';
      log.ai.error('Chat failed', { metadata: { error } });
      callbacks.onError(msg);
    }
  }
}

export const chatService = new ChatService();
