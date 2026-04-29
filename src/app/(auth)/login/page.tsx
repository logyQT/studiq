'use client';

import { useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { LoginSchema, type LoginInput } from '@/server/models/auth.model';
import { AppErrorCode } from '@/lib/errors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, Mail, Lock, AlertCircle } from 'lucide-react';
import Link from 'next/link';
import { cn } from '@/lib/utils';

export default function LoginPage() {
  const t = useTranslations('LoginPage');
  const tErr = useTranslations('Errors');
  const router = useRouter();
  const searchParams = useSearchParams();

  const errorParam = searchParams.get('error');

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: { email: '', password: '' },
  });

  const isLoading = form.formState.isSubmitting;

  async function onSubmit(data: LoginInput) {
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!result.success) {
        toast.error(tErr(result.error || AppErrorCode.INTERNAL_SERVER));
        return;
      }

      router.push('/dashboard');
      router.refresh();
    } catch {
      toast.error(tErr(AppErrorCode.INTERNAL_SERVER));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <Card className="w-full max-w-md shadow-lg border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">{t('header')}</CardTitle>
          <CardDescription className="text-center">{t('sub_header')}</CardDescription>
        </CardHeader>
        <CardContent>
          {errorParam && (
            <Alert
              variant="destructive"
              className="mb-6 bg-destructive/10 text-destructive border-destructive/20"
            >
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="font-medium">
                {tErr(errorParam || AppErrorCode.AUTH_CALLBACK_FAILED)}
              </AlertDescription>
            </Alert>
          )}

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="email"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('email_label')}</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          placeholder={t('email_placeholder')}
                          className={cn(
                            'pl-9',
                            fieldState.error && 'border-destructive focus-visible:ring-destructive',
                          )}
                          disabled={isLoading}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <FormField
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <div className="flex items-center justify-between">
                      <FormLabel>{t('password_label')}</FormLabel>
                      <Link
                        href="/password/reset"
                        className="text-sm font-medium text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                        tabIndex={-1}
                      >
                        {t('forgot_password')}
                      </Link>
                    </div>
                    <FormControl>
                      <div className="relative">
                        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                          type="password"
                          placeholder="••••••••"
                          className={cn(
                            'pl-9',
                            fieldState.error && 'border-destructive focus-visible:ring-destructive',
                          )}
                          disabled={isLoading}
                          {...field}
                        />
                      </div>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button
                type="submit"
                className="w-full flex items-center gap-2 mt-2"
                disabled={isLoading}
              >
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('login_button')}
              </Button>
            </form>
          </Form>

          <div className="mt-6 text-center text-sm">
            <span className="text-muted-foreground">{t('no_account')} </span>
            <Link href="/register" className="font-medium hover:underline underline-offset-4">
              {t('register_link')}
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
