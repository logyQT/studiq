import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const PLAN_SCOPES = ['personal', 'organization'] as const;
export type PlanScope = (typeof PLAN_SCOPES)[number];

export const PLAN_AUDIENCES = ['student', 'educator', 'manager'] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];

/** Shared field builders — the create/update schemas differ only in defaults. */
const KEY_FIELD = z
  .string({ error: ValidationErrorCode.REQUIRED })
  .nonempty({ error: ValidationErrorCode.REQUIRED })
  .min(1, { error: ValidationErrorCode.TOO_SHORT })
  .max(32, { error: ValidationErrorCode.TOO_LONG });
const NAME_FIELD = z
  .string({ error: ValidationErrorCode.REQUIRED })
  .nonempty({ error: ValidationErrorCode.REQUIRED })
  .min(2, { error: ValidationErrorCode.TOO_SHORT })
  .max(64, { error: ValidationErrorCode.TOO_LONG });

/** The shared scope/audience fields; create adds defaults, update stays partial. */
const PLAN_SCOPE_FIELD = z.enum(PLAN_SCOPES, { error: ValidationErrorCode.INVALID_INPUT });
const PLAN_AUDIENCE_FIELD = z.enum(PLAN_AUDIENCES, { error: ValidationErrorCode.INVALID_INPUT });

/**
 * The scope/audience pair rule, enforced at the model so a bad pair is a 422
 * instead of a database CHECK violation: organization plans carry no audience.
 * A personal plan carries no audience either since #1193 — one individual
 * ladder serves every persona — so only a non-null audience on an
 * organization plan is invalid. On update an absent field means "unchanged".
 */
function checkScopeAudience(
  data: { scope?: string; audience?: string | null },
  ctx: z.RefinementCtx,
): void {
  if (data.scope === 'organization' && data.audience != null) {
    ctx.addIssue({
      code: 'custom',
      path: ['audience'],
      message: ValidationErrorCode.INVALID_INPUT,
    });
  }
}

export const CreateSubscriptionPlanSchema = registry.register(
  'CreateSubscriptionPlanRequest',
  z
    .object({
      key: KEY_FIELD,
      name: NAME_FIELD,
      description: z
        .string({ error: ValidationErrorCode.INVALID_INPUT })
        .max(256, { error: ValidationErrorCode.TOO_LONG })
        .optional()
        .nullable()
        .default(null),
      priceMonthly: z
        .number({ error: ValidationErrorCode.NUMBER })
        .int({ error: ValidationErrorCode.INTEGER })
        .min(0, { error: ValidationErrorCode.TOO_SMALL })
        .optional()
        .default(0),
      priceYearly: z
        .number({ error: ValidationErrorCode.NUMBER })
        .int({ error: ValidationErrorCode.INTEGER })
        .min(0, { error: ValidationErrorCode.TOO_SMALL })
        .optional()
        .default(0),
      sortOrder: z
        .number({ error: ValidationErrorCode.NUMBER })
        .int({ error: ValidationErrorCode.INTEGER })
        .optional()
        .default(0),
      isActive: z.boolean({ error: ValidationErrorCode.BOOL }).optional().default(true),
      currency: z
        .string({ error: ValidationErrorCode.INVALID_INPUT })
        .min(2, { error: ValidationErrorCode.TOO_SHORT })
        .max(3, { error: ValidationErrorCode.TOO_LONG })
        .optional()
        .default('PLN'),
      scope: PLAN_SCOPE_FIELD.optional().default('personal'),
      audience: PLAN_AUDIENCE_FIELD.optional().nullable().default(null),
    })
    .superRefine(checkScopeAudience),
);

export const UpdateSubscriptionPlanSchema = registry.register(
  'UpdateSubscriptionPlanRequest',
  z
    .object({
      key: KEY_FIELD.optional(),
      name: NAME_FIELD.optional(),
      description: z
        .string({ error: ValidationErrorCode.INVALID_INPUT })
        .max(256, { error: ValidationErrorCode.TOO_LONG })
        .optional()
        .nullable(),
      priceMonthly: z
        .number({ error: ValidationErrorCode.NUMBER })
        .int({ error: ValidationErrorCode.INTEGER })
        .min(0, { error: ValidationErrorCode.TOO_SMALL })
        .optional(),
      priceYearly: z
        .number({ error: ValidationErrorCode.NUMBER })
        .int({ error: ValidationErrorCode.INTEGER })
        .min(0, { error: ValidationErrorCode.TOO_SMALL })
        .optional(),
      sortOrder: z
        .number({ error: ValidationErrorCode.NUMBER })
        .int({ error: ValidationErrorCode.INTEGER })
        .optional(),
      isActive: z.boolean({ error: ValidationErrorCode.BOOL }).optional(),
      currency: z
        .string({ error: ValidationErrorCode.INVALID_INPUT })
        .min(2, { error: ValidationErrorCode.TOO_SHORT })
        .max(3, { error: ValidationErrorCode.TOO_LONG })
        .optional(),
      scope: PLAN_SCOPE_FIELD.optional(),
      audience: PLAN_AUDIENCE_FIELD.optional().nullable(),
    })
    .superRefine(checkScopeAudience),
);

export const SubscriptionPlanIdParamsSchema = registry.register(
  'SubscriptionPlanIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export type CreateSubscriptionPlanInput = z.infer<typeof CreateSubscriptionPlanSchema>;
export type UpdateSubscriptionPlanInput = z.infer<typeof UpdateSubscriptionPlanSchema>;
export type SubscriptionPlanIdParams = z.infer<typeof SubscriptionPlanIdParamsSchema>;
