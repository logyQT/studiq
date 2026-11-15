'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { APP_ERRORS } from '@studiq/server/lib/errors';
import { type RegisterInput, RegisterSchema } from '@studiq/server/models/auth.model';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
  Item,
  ItemContent,
  ItemDescription,
  ItemTitle,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@studiq/ui';
import {
  ArrowRight,
  Building2,
  ChevronRight,
  GraduationCap,
  Loader2,
  Lock,
  type LucideIcon,
  Mail,
  User,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { type Control, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { FOCUS_RING } from '@/components/shared/focus-ring';
// `CONTROL_RADIUS` spells the token's value out because `cn` cannot collapse the
// marketing name against the kit's `rounded-md`, which would then win the cascade.
import { CONTROL_RADIUS } from '@/components/shared/preference-controls';
import { ApiError, apiPost } from '@/lib/api';
import { translateErrorCode } from '@/lib/error-messages';
import { cn } from '@/lib/utils';

interface RegisterFieldProps {
  control: Control<RegisterInput>;
  name: 'name' | 'email' | 'password';
  label: string;
  icon: LucideIcon;
  disabled: boolean;
  placeholder?: string;
  /** Only the password field overrides the input type; the rest are text. */
  type?: 'password';
  autoComplete?: string;
  description?: string;
}

/**
 * The three typed fields share one shell because the mark sits inside the control:
 * the input's left padding and the mark's position are a single decision, and the
 * description slot belongs to whichever field states a rule up front.
 */
function RegisterField({
  control,
  name,
  label,
  icon: Icon,
  disabled,
  placeholder,
  type,
  autoComplete,
  description,
}: RegisterFieldProps) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel htmlFor={field.name}>{label}</FormLabel>
          {/*
           * `FormControl` has to own the `<input>` itself: it is a Radix `Slot`, so
           * whatever element it wraps receives `aria-describedby` / `aria-invalid`.
           * Wrapping the icon's `<div>` put both attributes on that div instead, and
           * the password hint was never announced with the field.
           */}
          <div className="relative">
            <Icon
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            />
            <FormControl>
              <Input
                id={field.name}
                type={type}
                autoComplete={autoComplete}
                placeholder={placeholder}
                className={cn(
                  'pl-9',
                  CONTROL_RADIUS,
                  fieldState.error && 'border-destructive focus-visible:ring-destructive',
                )}
                disabled={disabled}
                {...field}
              />
            </FormControl>
          </div>
          {description ? <FormDescription>{description}</FormDescription> : null}
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

export function RegisterForm() {
  const t = useTranslations('RegisterPage');
  const tErr = useTranslations('Errors');
  const [isSuccess, setIsSuccess] = useState(false);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: { name: '', email: '', password: '' },
  });

  const isLoading = form.formState.isSubmitting;

  async function onSubmit(data: RegisterInput) {
    try {
      await apiPost('/api/v1/auth/register', data);
      setIsSuccess(true);
    } catch (error) {
      toast.error(
        translateErrorCode(
          tErr,
          error instanceof ApiError ? error.code : APP_ERRORS.INTERNAL_SERVER.code,
        ),
      );
    }
  }

  return (
    <>
      {/*
       * The returning visitor's exit is a link, not a second button: the submit below
       * stays the page's only action. Hidden in the success state, where it would ask
       * a question the visitor has just answered while `/login` is already offered.
       */}
      {!isSuccess && (
        <p className="mb-8 flex items-baseline justify-end gap-1.5 text-sm">
          <span className="text-muted-foreground">{t('have_account')}</span>
          <Link
            href="/login"
            className={cn(
              'inline-flex min-h-6 items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline',
              FOCUS_RING,
            )}
          >
            {t('login_link')}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </p>
      )}

      <h2 className="text-h3 font-semibold text-balance">
        {isSuccess ? t('success_header') : t('header')}
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {isSuccess ? t('success_description') : t('sub_header')}
      </p>

      {isSuccess ? (
        <div className="mt-8 space-y-4">
          {/* `--success` is the audited confirmation colour (5.16:1 on paper). */}
          <div className="flex items-start gap-3 rounded-panel border border-success/30 bg-success/5 p-4">
            <Mail aria-hidden className="mt-0.5 size-4 shrink-0 text-success" />
            <p className="text-sm font-medium text-success">{t('SUCCESS_ACTIVATION_LINK_SENT')}</p>
          </div>

          <p className="text-sm text-muted-foreground">{t('activation_instructions')}</p>

          {/* The submit is gone, so this is the screen's single action. */}
          <CtaButton href="/login" tone="primary" fullWidth>
            {t('back_to_login')}
          </CtaButton>
        </div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <RegisterField
              control={form.control}
              name="name"
              label={t('name_label')}
              icon={User}
              placeholder={t('name_placeholder')}
              autoComplete="name"
              disabled={isLoading}
            />
            <RegisterField
              control={form.control}
              name="email"
              label={t('email_label')}
              icon={Mail}
              placeholder={t('email_placeholder')}
              // No `type="email"`: native validation would pre-empt the Zod message.
              autoComplete="email"
              disabled={isLoading}
            />
            <FormField
              control={form.control}
              name="accountType"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('account_type_label')}</FormLabel>
                  <FormControl>
                    <Select onValueChange={field.onChange} defaultValue={field.value}>
                      <SelectTrigger
                        className={cn(
                          'w-full',
                          CONTROL_RADIUS,
                          fieldState.error && 'border-destructive focus-visible:ring-destructive',
                        )}
                        /*
                         * `FormControl` wraps the Radix Root, which drops the `id` it
                         * supplies, so the visible label's `for` reaches no element and
                         * the combobox would be named by its placeholder. Same string,
                         * carried as the name.
                         */
                        aria-label={t('account_type_label')}
                        aria-invalid={!!fieldState.error}
                      >
                        <SelectValue placeholder={t('account_type_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectGroup>
                          <SelectItem value="student" className="py-3">
                            <Item size="sm" className="w-full p-0">
                              <ItemContent className="gap-0">
                                <ItemTitle className="flex items-center gap-2 font-sans">
                                  <User className="size-4" />
                                  {t('account_type_student')}
                                </ItemTitle>
                                <ItemDescription className="text-xs font-normal">
                                  {t('account_type_student_desc')}
                                </ItemDescription>
                              </ItemContent>
                            </Item>
                          </SelectItem>
                          <SelectItem value="educator" className="py-3">
                            <Item size="sm" className="w-full p-0">
                              <ItemContent className="gap-0">
                                <ItemTitle className="flex items-center gap-2 font-sans">
                                  <GraduationCap className="size-4" />
                                  {t('account_type_teacher')}
                                </ItemTitle>
                                <ItemDescription className="text-xs font-normal">
                                  {t('account_type_teacher_desc')}
                                </ItemDescription>
                              </ItemContent>
                            </Item>
                          </SelectItem>
                          <SelectItem value="manager" className="py-3">
                            <Item size="sm" className="w-full p-0">
                              <ItemContent className="gap-0">
                                <ItemTitle className="flex items-center gap-2 font-sans">
                                  <Building2 className="size-4" />
                                  {t('account_type_manager')}
                                </ItemTitle>
                                <ItemDescription className="text-xs font-normal">
                                  {t('account_type_manager_desc')}
                                </ItemDescription>
                              </ItemContent>
                            </Item>
                          </SelectItem>
                        </SelectGroup>
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <RegisterField
              control={form.control}
              name="password"
              label={t('password_label')}
              icon={Lock}
              type="password"
              autoComplete="new-password"
              description={t('password_hint')}
              disabled={isLoading}
            />
            {/*
             * Cobalt, not `signal`: this page's accent is the panel's underline, so
             * the action takes the brand fill and the two never compete at button
             * scale (DESIGN.md §Dosage).
             */}
            <CtaButton submit tone="primary" fullWidth disabled={isLoading}>
              {t('register_button')}
              {/* Both glyphs are decorative: the button's name stays the label alone. */}
              {isLoading ? (
                <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <ChevronRight aria-hidden className="size-4" />
              )}
            </CtaButton>
          </form>
        </Form>
      )}
    </>
  );
}
