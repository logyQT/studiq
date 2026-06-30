import { ValidationErrorCode } from '@/lib/validation-errors';
import { registry, z } from '@/lib/zod';

export const CreateOrganizationSchema = registry.register(
  'CreateOrganizationRequest',
  z.object({
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    slug: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(16, { error: ValidationErrorCode.TOO_LONG }),
  }),
);

export const UpdateOrganizationSchema = registry.register(
  'UpdateOrganizationRequest',
  z
    .object({
      name: z
        .string({ error: ValidationErrorCode.REQUIRED })
        .nonempty({ error: ValidationErrorCode.REQUIRED })
        .min(3, { error: ValidationErrorCode.TOO_SHORT })
        .max(64, { error: ValidationErrorCode.TOO_LONG })
        .optional(),
      slug: z
        .string({ error: ValidationErrorCode.REQUIRED })
        .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
        .nonempty({ error: ValidationErrorCode.REQUIRED })
        .min(2, { error: ValidationErrorCode.TOO_SHORT })
        .max(16, { error: ValidationErrorCode.TOO_LONG })
        .optional(),
    })
    .refine((data) => data.name !== undefined || data.slug !== undefined, {
      message: ValidationErrorCode.INVALID_INPUT,
    }),
);

export const OrganizationIdParamsSchema = registry.register(
  'OrganizationIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const OrganizationResponseSchema = registry.register(
  'OrganizationResponse',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.UUID_INVALID }),
    name: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(3, { error: ValidationErrorCode.TOO_SHORT })
      .max(64, { error: ValidationErrorCode.TOO_LONG }),
    slug: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .regex(/^[a-z0-9-]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .min(2, { error: ValidationErrorCode.TOO_SHORT })
      .max(16, { error: ValidationErrorCode.TOO_LONG }),
    created_at: z.iso.datetime(),
  }),
);

export type CreateOrganizationInput = z.infer<typeof CreateOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof UpdateOrganizationSchema>;
export type OrganizationIdParams = z.infer<typeof OrganizationIdParamsSchema>;
export type OrganizationResponse = z.infer<typeof OrganizationResponseSchema>;
