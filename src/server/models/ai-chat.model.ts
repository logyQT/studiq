import { z } from '@/lib/zod';

export const ChatRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  file: z.object({
    data: z.string().min(1),
    mimeType: z.string().min(1),
  }).optional(),
});

export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
