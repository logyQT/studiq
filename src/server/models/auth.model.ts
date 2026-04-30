import { z, registry } from '@/lib/zod';
import { AppErrorCode } from '@/lib/errors';

const passwordSchema = z
  .string({ error: AppErrorCode.PASSWORD_REQUIRED })
  .min(8, { error: AppErrorCode.PASSWORD_TOO_SHORT })
  .max(128, { error: AppErrorCode.PASSWORD_TOO_LONG })
  .regex(/[A-Z]/, { error: AppErrorCode.PASSWORD_MISSING_UPPERCASE })
  .regex(/[0-9]/, { error: AppErrorCode.PASSWORD_MISSING_NUMBER });

export const RegisterSchema = registry.register(
  'RegisterRequest',
  z.object({
    name: z
      .string({ error: AppErrorCode.NAME_REQUIRED })
      .min(2, { error: AppErrorCode.NAME_TOO_SHORT })
      .regex(/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+$/, { error: AppErrorCode.NAME_INVALID_FORMAT }),
    email: z.email({ error: AppErrorCode.EMAIL_INVALID }),
    password: passwordSchema,
  }),
);

export const LoginSchema = registry.register(
  'LoginRequest',
  z.object({
    email: z.email({ error: AppErrorCode.EMAIL_INVALID }),
    password: z
      .string({ error: AppErrorCode.PASSWORD_REQUIRED })
      .min(1, { error: AppErrorCode.PASSWORD_REQUIRED }),
  }),
);

export const forgotPasswordSchema = registry.register(
  'ForgotPasswordRequest',
  z.object({
    email: z.email({ error: AppErrorCode.EMAIL_INVALID }),
  }),
);

export const updatePasswordSchema = registry
  .register(
    'UpdatePasswordRequest',
    z.object({
      password: passwordSchema,
      confirmPassword: z.string(),
    }),
  )
  .refine((data) => data.password === data.confirmPassword, {
    message: AppErrorCode.PASSWORDS_DO_NOT_MATCH,
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

export type { User } from '@supabase/supabase-js';
