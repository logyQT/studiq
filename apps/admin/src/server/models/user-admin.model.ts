import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';

export const ACCOUNT_TYPES = ['student', 'educator', 'manager'] as const;

export const ListUsersQuerySchema = registry.register(
  'ListUsersQuery',
  z.object({
    page: z.coerce.number().int().min(1).optional().default(1),
    perPage: z.coerce.number().int().min(1).max(200).optional().default(50),
    search: z.string().trim().min(1).optional(),
    status: z.enum(['active', 'deleted']).optional().default('active'),
  }),
);

export const CreateUserSchema = registry.register(
  'CreateUserRequest',
  z.object({
    email: z.email({ error: ValidationErrorCode.INVALID_INPUT }),
    password: z
      .string({ error: ValidationErrorCode.REQUIRED })
      .min(8, { error: ValidationErrorCode.TOO_SHORT }),
    fullName: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .trim()
      .min(1, { error: ValidationErrorCode.TOO_SHORT })
      .max(120, { error: ValidationErrorCode.TOO_LONG })
      .optional(),
    accountType: z.enum(ACCOUNT_TYPES, { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

export const UpdateUserAccountTypeSchema = registry.register(
  'UpdateUserAccountTypeRequest',
  z.object({
    accountType: z.enum(ACCOUNT_TYPES, { error: ValidationErrorCode.INVALID_INPUT }),
  }),
);

// Route params reach the service straight from the URL, so they have to be
// validated like any other input: an unparseable id would otherwise be sent
// to Postgres/GoTrue and surface as a 500 instead of a 422.
export const UserIdParamSchema = registry.register(
  'UserIdParam',
  z.uuid({ error: ValidationErrorCode.INVALID_INPUT }),
);

export type ListUsersQuery = z.infer<typeof ListUsersQuerySchema>;
export type UserIdParam = z.infer<typeof UserIdParamSchema>;
export type CreateUserInput = z.infer<typeof CreateUserSchema>;
export type UpdateUserAccountTypeInput = z.infer<typeof UpdateUserAccountTypeSchema>;
