'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Loader2, Lock, Mail, User } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { APP_ERRORS } from '@/lib/errors';
import { cn } from '@/lib/utils';
import { type RegisterInput, RegisterSchema } from '@/server/models/auth.model';

export default function RegisterPage() {
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
      const response = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!result.success) {
        toast.error(tErr(result.error || APP_ERRORS.INTERNAL_SERVER.code));
        return;
      }

      setIsSuccess(true);
    } catch {
      toast.error(tErr(APP_ERRORS.INTERNAL_SERVER.code));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <Card className="w-full max-w-md shadow-lg border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">
            {isSuccess ? t('success_header') : t('header')}
          </CardTitle>
          <CardDescription className="text-center">
            {isSuccess ? t('success_description') : t('sub_header')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isSuccess ? (
            <div className="space-y-4">
              <Alert className="items-center border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                <Mail className="h-4 w-4 !translate-y-0" />
                <AlertDescription className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {t('SUCCESS_ACTIVATION_LINK_SENT')}
                </AlertDescription>
              </Alert>

              <p className="text-sm text-muted-foreground text-center px-2">
                {t('activation_instructions')}
              </p>

              <Button asChild className="w-full mt-2">
                <Link href="/login">{t('back_to_login')}</Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel htmlFor={field.name}>{t('name_label')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <User className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            autoComplete="name"
                            id={field.name}
                            placeholder={t('name_placeholder')}
                            className={cn(
                              'pl-9',
                              fieldState.error &&
                                'border-destructive focus-visible:ring-destructive',
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
                  name="email"
                  render={({ field, fieldState }) => (
                    <FormItem>
                      <FormLabel htmlFor={field.name}>{t('email_label')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            id={field.name}
                            placeholder={t('email_placeholder')}
                            className={cn(
                              'pl-9',
                              fieldState.error &&
                                'border-destructive focus-visible:ring-destructive',
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
                      <FormLabel htmlFor={field.name}>{t('password_label')}</FormLabel>
                      <FormControl>
                        <div className="relative">
                          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                          <Input
                            id={field.name}
                            type="password"
                            placeholder="********"
                            className={cn(
                              'pl-9',
                              fieldState.error &&
                                'border-destructive focus-visible:ring-destructive',
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
                <Button type="submit" className="w-full gap-2 mt-2" disabled={isLoading}>
                  {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  {t('register_button')}
                </Button>
              </form>
            </Form>
          )}

          {!isSuccess && (
            <div className="mt-6 text-center text-sm">
              <span className="text-muted-foreground">{t('have_account')} </span>
              <Link href="/login" className="font-medium hover:underline underline-offset-4">
                {t('login_link')}
              </Link>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
