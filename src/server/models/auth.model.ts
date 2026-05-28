import { z, registry } from '@/lib/zod';
import { ValidationErrorCode } from '@/lib/validation-errors';
import { User as SupabaseUser } from '@supabase/supabase-js';
import { UserRole } from '@/types';

export const NameSchema = z
  .string({ error: ValidationErrorCode.NAME_REQUIRED })
  .nonempty({ error: ValidationErrorCode.NAME_REQUIRED })
  .min(2, { error: ValidationErrorCode.NAME_TOO_SHORT })
  .regex(/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+$/, { error: ValidationErrorCode.NAME_INVALID_FORMAT });

export const passwordSchema = z
  .string({ error: ValidationErrorCode.PASSWORD_REQUIRED })
  .nonempty({ error: ValidationErrorCode.PASSWORD_REQUIRED })
  .min(8, { error: ValidationErrorCode.PASSWORD_TOO_SHORT })
  .max(128, { error: ValidationErrorCode.PASSWORD_TOO_LONG })
  .regex(/[A-Z]/, { error: ValidationErrorCode.PASSWORD_MISSING_UPPERCASE })
  .regex(/[0-9]/, { error: ValidationErrorCode.PASSWORD_MISSING_NUMBER });

export const RegisterSchema = registry.register(
  'RegisterRequest',
  z.object({
    name: NameSchema,
    email: z
      .email({ error: ValidationErrorCode.EMAIL_INVALID })
      .nonempty({ error: ValidationErrorCode.EMAIL_REQUIRED }),
    password: passwordSchema,
    inviteToken: z.string().optional(),
  }),
);

export const LoginSchema = registry.register(
  'LoginRequest',
  z.object({
    email: z
      .email({ error: ValidationErrorCode.EMAIL_INVALID })
      .nonempty({ error: ValidationErrorCode.EMAIL_REQUIRED }),
    password: z
      .string({ error: ValidationErrorCode.PASSWORD_REQUIRED })
      .nonempty({ error: ValidationErrorCode.PASSWORD_REQUIRED }),
  }),
);

export const forgotPasswordSchema = registry.register(
  'ForgotPasswordRequest',
  z.object({
    email: z
      .email({ error: ValidationErrorCode.EMAIL_INVALID })
      .nonempty({ error: ValidationErrorCode.EMAIL_REQUIRED }),
  }),
);

export const updatePasswordSchema = registry
  .register(
    'UpdatePasswordRequest',
    z.object({
      password: passwordSchema,
      confirmPassword: z.coerce
        .string({ error: ValidationErrorCode.PASSWORD_CONFIRMATION_REQUIRED })
        .nonempty({ error: ValidationErrorCode.PASSWORD_CONFIRMATION_REQUIRED }),
    }),
  )
  .refine((data) => data.password === data.confirmPassword, {
    message: ValidationErrorCode.PASSWORDS_DO_NOT_MATCH,
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

export type User = SupabaseUser & {
  app_metadata: SupabaseUser['app_metadata'] & {
    role?: UserRole;
  };
};
