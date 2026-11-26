import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

/** The most rows one import accepts; the dialog refuses a longer file before sending it. */
export const CSV_IMPORT_MAX_ROWS = 500;

/** One side of a card: more than blank space, and otherwise kept exactly as written. */
const CardSideSchema = z
  .string({ error: ValidationErrorCode.INVALID_INPUT })
  .max(5000, { error: ValidationErrorCode.TOO_LONG })
  .refine((value) => value.trim() !== '', { error: ValidationErrorCode.REQUIRED });

export const CsvImportRowSchema = registry.register(
  'CsvImportRow',
  z.object({
    front: CardSideSchema,
    back: CardSideSchema,
    topic: z.string().trim().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
    deck: z.string().trim().max(255, { error: ValidationErrorCode.TOO_LONG }).optional(),
  }),
);

/**
 * The request as a whole. Rows are only required to be objects here: each is judged by
 * `CsvImportRowSchema` on its own, so one bad row does not refuse the others.
 */
export const CsvImportSchema = registry.register(
  'CsvImportRequest',
  z.object({
    deckId: z.string().uuid({ error: ValidationErrorCode.UUID_INVALID }).optional(),
    defaultDeckName: z
      .string()
      .trim()
      .min(1, { error: ValidationErrorCode.REQUIRED })
      .max(64, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    cards: z
      .array(z.record(z.string(), z.unknown()))
      .min(1, { error: ValidationErrorCode.TOO_FEW })
      .max(CSV_IMPORT_MAX_ROWS, { error: ValidationErrorCode.TOO_MANY }),
  }),
);

export const CsvImportRowErrorSchema = z.object({
  /** 1-based position of the row in the request: the dialog's „#” column, header not counted. */
  row: z.number(),
  field: CsvImportRowSchema.keyof(),
  /** A `ValidationErrorCode`; the client translates it. */
  error: z.string(),
});

export const CsvImportResultSchema = registry.register(
  'CsvImportResult',
  z.object({
    total: z.number(),
    imported: z.number(),
    errors: z.array(CsvImportRowErrorSchema),
  }),
);

export type CsvImportRow = z.infer<typeof CsvImportRowSchema>;
/** What the service writes: the request's destination and the rows that passed. */
export type CsvImportBatch = Omit<z.infer<typeof CsvImportSchema>, 'cards'> & {
  cards: CsvImportRow[];
};
export type CsvImportRowError = z.infer<typeof CsvImportRowErrorSchema>;
export type CsvImportResult = z.infer<typeof CsvImportResultSchema>;
