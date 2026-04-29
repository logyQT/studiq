import { z, registry } from '@/lib/zod';

const passwordSchema = z
  .string({ error: 'ERROR_PASSWORD_REQUIRED' })
  .min(8, { error: 'ERROR_PASSWORD_TOO_SHORT' })
  .max(128, { error: 'ERROR_PASSWORD_TOO_LONG' })
  .regex(/[A-Z]/, { error: 'ERROR_PASSWORD_MISSING_UPPERCASE' })
  .regex(/[0-9]/, { error: 'ERROR_PASSWORD_MISSING_NUMBER' });

export const RegisterSchema = registry.register(
  'RegisterRequest',
  z.object({
    name: z
      .string({ error: 'ERROR_NAME_REQUIRED' })
      .min(2, { error: 'ERROR_NAME_TOO_SHORT' })
      .regex(/^[a-zA-ZąćęłńóśźżĄĆĘŁŃÓŚŹŻ\s]+$/, { error: 'ERROR_NAME_INVALID_FORMAT' }),
    email: z.email({ error: 'ERROR_EMAIL_INVALID' }),
    password: passwordSchema,
  }),
);

export const LoginSchema = registry.register(
  'LoginRequest',
  z.object({
    email: z.email({ error: 'ERROR_EMAIL_INVALID' }),
    password: z
      .string({ error: 'ERROR_PASSWORD_REQUIRED' })
      .min(1, { error: 'ERROR_PASSWORD_REQUIRED' }),
  }),
);

export const forgotPasswordSchema = registry.register(
  'ForgotPasswordRequest',
  z.object({
    email: z.email({ error: 'ERROR_INVALID_EMAIL' }),
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
    message: 'ERROR_PASSWORDS_DO_NOT_MATCH',
    path: ['confirmPassword'],
  });

export type RegisterInput = z.infer<typeof RegisterSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type UpdatePasswordInput = z.infer<typeof updatePasswordSchema>;

export type { User } from '@supabase/supabase-js';
