import { PLAN_BILLING_MODES, PLAN_SCOPES, PLAN_VISIBILITIES } from '@studiq/authz';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

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

/** The shared scope field; create adds a default, update stays partial. */
const PLAN_SCOPE_FIELD = z.enum(PLAN_SCOPES, { error: ValidationErrorCode.INVALID_INPUT });

const PLAN_VISIBILITY_FIELD = z.enum(PLAN_VISIBILITIES, {
  error: ValidationErrorCode.INVALID_INPUT,
});

const PLAN_BILLING_MODE_FIELD = z.enum(PLAN_BILLING_MODES, {
  error: ValidationErrorCode.INVALID_INPUT,
});

export const CreateSubscriptionPlanSchema = registry.register(
  'CreateSubscriptionPlanRequest',
  z.object({
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
    visibility: PLAN_VISIBILITY_FIELD.optional().default('public'),
    billingMode: PLAN_BILLING_MODE_FIELD.optional().default('stripe'),
  }),
);

export const UpdateSubscriptionPlanSchema = registry.register(
  'UpdateSubscriptionPlanRequest',
  z.object({
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
    visibility: PLAN_VISIBILITY_FIELD.optional(),
    billingMode: PLAN_BILLING_MODE_FIELD.optional(),
  }),
);

export const SubscriptionPlanIdParamsSchema = registry.register(
  'SubscriptionPlanIdParams',
  z.object({
    id: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

/** The organization an unlisted plan is pinned to (B3, #1495). */
export const AssignPlanOrganizationSchema = registry.register(
  'AssignPlanOrganizationRequest',
  z.object({
    organizationId: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const PlanAssignmentParamsSchema = registry.register(
  'PlanAssignmentParams',
  z.object({
    organizationId: z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

/** The plan an organization moves to, from the `/orgs` plan picker (B3). */
export const SetOrganizationPlanSchema = registry.register(
  'SetOrganizationPlanRequest',
  z.object({
    plan: KEY_FIELD,
  }),
);

export type CreateSubscriptionPlanInput = z.infer<typeof CreateSubscriptionPlanSchema>;
export type UpdateSubscriptionPlanInput = z.infer<typeof UpdateSubscriptionPlanSchema>;
export type SubscriptionPlanIdParams = z.infer<typeof SubscriptionPlanIdParamsSchema>;
export type AssignPlanOrganizationInput = z.infer<typeof AssignPlanOrganizationSchema>;
export type PlanAssignmentParams = z.infer<typeof PlanAssignmentParamsSchema>;
export type SetOrganizationPlanInput = z.infer<typeof SetOrganizationPlanSchema>;
