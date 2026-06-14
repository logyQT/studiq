import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';

export const CsvImportRowSchema = registry.register(
  'CsvImportRow',
  z.object({
    front: z.string().min(1, { error: ValidationErrorCode.REQUIRED }).max(255, { error: ValidationErrorCode.TOO_LONG }),
    back: z.string().min(1, { error: ValidationErrorCode.REQUIRED }).max(255, { error: ValidationErrorCode.TOO_LONG }),
    topic: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    deck: z.string().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
  }),
);

export const CsvImportSchema = registry.register(
  'CsvImportRequest',
  z.object({
    deckId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    defaultDeckName: z.string().min(1).max(64).optional(),
    cards: z.array(CsvImportRowSchema).min(1, { error: ValidationErrorCode.TOO_FEW }).max(500, { error: ValidationErrorCode.TOO_MANY }),
  }),
);

export const CsvImportResultSchema = registry.register(
  'CsvImportResult',
  z.object({
    total: z.number(),
    imported: z.number(),
    errors: z.array(z.object({
      row: z.number(),
      error: z.string(),
    })),
  }),
);

export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;
export type CsvImportInput = z.infer<typeof CsvImportSchema>;
export type CsvImportResult = z.infer<typeof CsvImportResultSchema>;
