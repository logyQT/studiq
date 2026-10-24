import type { AccountType } from '@studiq/authz';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import type { User as SupabaseUser } from '@supabase/supabase-js';

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
    accountType: z.enum(['student', 'educator', 'manager'], {
      error: ValidationErrorCode.INVALID_INPUT,
    }),
    // Only sent by the invite-link flow (`/join?token=…`). The token is the
    // capability; its validity is checked in `AuthService.register()` before the
    // account exists and it is consumed after the e-mail is verified (#311).
    inviteToken: z
      .string({ error: ValidationErrorCode.INVALID_INPUT })
      .nonempty({ error: ValidationErrorCode.REQUIRED })
      .max(128, { error: ValidationErrorCode.INVALID_INPUT })
      .optional(),
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
      // Only sent by the account page; the password-reset flow omits it and is
      // authorised by a fresh OTP session instead (see auth.service).
      // Deliberately not `passwordSchema`: the current password must verify even
      // when it predates the current strength policy (e.g. the seeded `pass`).
      currentPassword: z
        .string({ error: ValidationErrorCode.PASSWORD_REQUIRED })
        .nonempty({ error: ValidationErrorCode.PASSWORD_REQUIRED })
        .max(128, { error: ValidationErrorCode.PASSWORD_TOO_LONG })
        .optional(),
      password: passwordSchema,
      confirmPassword: z
        .string({ error: ValidationErrorCode.PASSWORD_CONFIRMATION_REQUIRED })
        .nonempty({ error: ValidationErrorCode.PASSWORD_CONFIRMATION_REQUIRED }),
    }),
  )
  .refine((data) => data.password === data.confirmPassword, {
    message: ValidationErrorCode.PASSWORDS_DO_NOT_MATCH,
    path: ['confirmPassword'],
  });

export const UpdateProfileSchema = registry.register(
  'UpdateProfileRequest',
  z.object({
    name: NameSchema,
  }),
);

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;
export type UpdateProfileInput = z.infer<typeof UpdateProfileSchema>;

export type User = SupabaseUser & {
  app_metadata: SupabaseUser['app_metadata'] & {
    accountType?: AccountType;
  };
};
