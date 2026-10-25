import type { AccountType } from '@studiq/authz';
import { ValidationErrorCode } from '@studiq/server/lib/validation-errors';
import { registry, z } from '@studiq/server/lib/zod';
import type { User as SupabaseUser } from '@supabase/supabase-js';

// A name part is one or more ASCII/Polish letters plus the separators a real
// name can contain: a hyphen for double-barrelled surnames („Anna-Maria”) and an
// ASCII or typographic apostrophe for Irish/English names („Jan O'Brien”,
// „O’Brien”) — #302.
const NAME_PART = "[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ'’-]+";

// Normalize before validating: `.trim()` is the first check, so every later
// check (and the parsed output) sees the trimmed value. A whitespace-only name
// collapses to "" and is reported as required instead of counting its spaces
// towards `min(2)` (#303). Only single spaces may separate name parts — the old
// `\s` class admitted tabs/newlines, making any 2+ whitespace characters a
// "valid" name and letting padded values reach user metadata untrimmed.
export const NameSchema = z
  .string({ error: ValidationErrorCode.NAME_REQUIRED })
  .trim()
  .nonempty({ error: ValidationErrorCode.NAME_REQUIRED })
  .min(2, { error: ValidationErrorCode.NAME_TOO_SHORT })
  .regex(new RegExp(`^${NAME_PART}(?: ${NAME_PART})*$`), {
    error: ValidationErrorCode.NAME_INVALID_FORMAT,
  });

export const passwordSchema = z
  .string({ error: ValidationErrorCode.PASSWORD_REQUIRED })
  .nonempty({ error: ValidationErrorCode.PASSWORD_REQUIRED })
  .min(8, { error: ValidationErrorCode.PASSWORD_TOO_SHORT })
  .max(128, { error: ValidationErrorCode.PASSWORD_TOO_LONG })
  .regex(/[A-Z]/, { error: ValidationErrorCode.PASSWORD_MISSING_UPPERCASE })
  .regex(/[0-9]/, { error: ValidationErrorCode.PASSWORD_MISSING_NUMBER });

// Presence before format: an empty/missing e-mail must report EMAIL_REQUIRED,
// not EMAIL_INVALID. Chaining `.email().nonempty()` runs both checks on `""` and
// yields both codes; the pipe stops after the presence failure (#299).
const requiredEmailSchema = z
  .string({ error: ValidationErrorCode.EMAIL_REQUIRED })
  .nonempty({ error: ValidationErrorCode.EMAIL_REQUIRED })
  .pipe(z.email({ error: ValidationErrorCode.EMAIL_INVALID }));

export const RegisterSchema = registry.register(
  'RegisterRequest',
  z.object({
    name: NameSchema,
    email: requiredEmailSchema,
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
    email: requiredEmailSchema,
    password: z
      .string({ error: ValidationErrorCode.PASSWORD_REQUIRED })
      .nonempty({ error: ValidationErrorCode.PASSWORD_REQUIRED }),
  }),
);

export const forgotPasswordSchema = registry.register(
  'ForgotPasswordRequest',
  z.object({
    email: requiredEmailSchema,
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
