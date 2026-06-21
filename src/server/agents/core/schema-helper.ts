import type { z } from '@/lib/zod';

export function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = schema.toJSONSchema() as Record<string, unknown>;
  delete raw['$schema'];
  return raw;
}
