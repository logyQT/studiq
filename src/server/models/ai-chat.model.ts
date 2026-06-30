import { z } from '@/lib/zod';

export const ChatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1),
});

export const ChatRequestSchema = z.object({
  text: z.string().max(10000),
  context: z.string().optional(),
  conversationId: z.string().uuid().optional(),
  messages: z.array(ChatMessageSchema).max(100).optional(),
  file: z
    .object({
      data: z.string().min(1),
      mimeType: z.string().min(1),
    })
    .optional(),
});

export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
