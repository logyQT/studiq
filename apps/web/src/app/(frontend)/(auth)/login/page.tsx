'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { APP_ERRORS } from '@studiq/server/lib/errors';
import { type LoginInput, LoginSchema } from '@studiq/server/models/auth.model';
import { Form } from '@studiq/ui';
import {
  AlertCircle,
  ArrowRight,
  ChevronRight,
  GraduationCap,
  Loader2,
  Lock,
  Mail,
} from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { DevQuickLogin } from '@/components/dev/dev-quick-login';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { useAuth } from '@/components/providers/AuthProvider';
import { AuthField } from '@/components/shared/auth-field';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { ApiError, apiPost } from '@/lib/api';
import { translateErrorCode } from '@/lib/error-messages';
import { toSafeInternalPath } from '@/lib/safe-redirect';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const t = useTranslations('LoginPage');
  const tErr = useTranslations('Errors');
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useAuth();

  const errorParam = searchParams.get('error');

  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  // Same validation the proxy applies to `?next=` (single implementation, so a
  // deep link can never be handled differently by the two callers).
  const nextParam = toSafeInternalPath(searchParams.get('next'), origin);

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const isLoading = form.formState.isSubmitting;

  async function onSubmit(data: LoginInput) {
    try {
      await apiPost('/api/v1/auth/login', data);

      await refresh();

      if (nextParam) {
        // `replace`, not `push`: after a successful login the form must not be
        // a back target (back would re-enter the pre-auth state).
        router.replace(nextParam);
      } else {
        router.refresh();
      }
    } catch (error) {
      // A rejected login is the usual 4xx: `ApiError` carries the app error code.
      toast.error(
        translateErrorCode(
          tErr,
          error instanceof ApiError ? error.code : APP_ERRORS.INTERNAL_SERVER.code,
        ),
      );
    }
  }

  return (
    /*
     * One centred column on paper: `/register` is the split page, this is the quiet
     * one. `bg-paper-grain` carries its own `.dark &` block, so the class paints the
     * landing's two light pools and the grain in both themes — here, unlike
     * `/register`'s column, the light pools belong on the page.
     */
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 bg-paper-grain p-content">
      <div className="w-full max-w-md">
        {/* No `useBranding`: this page has no active org, so the wordmark is the product's. */}
        <Link
          href="/"
          className={cn(
            'mb-8 inline-flex h-9 w-fit items-center gap-2 rounded-control text-xl font-bold tracking-tight text-primary transition-opacity hover:opacity-80',
            FOCUS_RING,
          )}
        >
          <GraduationCap aria-hidden className="size-6" />
          StudiQ
        </Link>

        <h1 className="font-display text-h2 font-semibold text-balance">{t('header')}</h1>
        <p className="mt-2 text-lede text-muted-foreground">{t('sub_header')}</p>

        {errorParam && (
          /*
           * `role="alert"` because this arrival is not the visitor's action: the
           * callback redirected here with the code, and a screen reader has no other
           * cue that something failed.
           *
           * The words are ink and the state is carried by the icon and the edge:
           * `--destructive` as text measures 3.59–3.88:1 on the grain's darkest
           * pixel (and 4.19:1 over the band the form occupies), under the 4.5:1
           * floor, while ink holds 14.2:1.
           */
          <div
            role="alert"
            className="mt-6 flex items-start gap-3 rounded-panel border border-destructive/40 p-4"
          >
            <AlertCircle aria-hidden className="mt-0.5 size-4 shrink-0 text-destructive" />
            <p className="text-sm font-medium text-foreground">
              {translateErrorCode(tErr, errorParam || APP_ERRORS.INTERNAL_SERVER.code)}
            </p>
          </div>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="mt-8 space-y-4">
            <AuthField
              control={form.control}
              name="email"
              label={t('email_label')}
              icon={Mail}
              placeholder={t('email_placeholder')}
              // No `type="email"`: native validation would pre-empt the Zod message.
              autoComplete="email"
              disabled={isLoading}
            />
            <AuthField
              control={form.control}
              name="password"
              label={t('password_label')}
              icon={Lock}
              type="password"
              placeholder="••••••••"
              // `current-password`, not `new-password`: this form signs in.
              autoComplete="current-password"
              disabled={isLoading}
              /*
               * Deliberately out of the tab order (`tabIndex={-1}`): NFR-05 records
               * the reset flow as reachable by pointer only, so Tab from the e-mail
               * field goes straight to the password field. Not a visual decision.
               */
              labelAction={
                <Link
                  href="/password/reset"
                  tabIndex={-1}
                  className="text-sm font-medium text-muted-foreground underline-offset-4 hover:text-primary hover:underline"
                >
                  {t('forgot_password')}
                </Link>
              }
            />
            {/*
             * Cobalt, like `/register`: the two credential pages read as one family,
             * and this page's only saturated fill is its action (DESIGN §Dosage).
             */}
            <CtaButton submit tone="primary" fullWidth disabled={isLoading}>
              {t('login_button')}
              {/* Both glyphs are decorative: the button's name stays the label alone. */}
              {isLoading ? (
                <Loader2 aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
              ) : (
                <ChevronRight aria-hidden className="size-4" />
              )}
            </CtaButton>
          </form>
        </Form>

        <p className="mt-6 flex items-baseline gap-1.5 text-sm">
          <span className="text-muted-foreground">{t('no_account')}</span>
          <Link
            href="/register"
            className={cn(
              'inline-flex min-h-6 items-center gap-1 font-semibold text-primary underline-offset-4 hover:underline',
              FOCUS_RING,
            )}
          >
            {t('register_link')}
            <ArrowRight aria-hidden className="size-4" />
          </Link>
        </p>
      </div>

      <DevQuickLogin />
    </main>
  );
}
