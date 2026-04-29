'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslations } from 'next-intl';
import { forgotPasswordSchema, type ForgotPasswordInput } from '@/server/models/auth.model';
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Mail } from 'lucide-react';
import Link from 'next/link';

export default function PasswordResetPage() {
  const t = useTranslations('PasswordResetPage');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');

  const form = useForm<ForgotPasswordInput>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: '' },
  });

  async function onSubmit(data: ForgotPasswordInput) {
    setStatus('loading');
    try {
      const response = await fetch('/api/v1/auth/password/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();
      if (!result.success) throw new Error(result.error);

      setStatus('success');
    } catch (error) {
      console.error(error);
      setStatus('error');
    }
  }

  return (
    // Ujednolicone tło z LoginPage i RegisterPage
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <Card className="w-full max-w-md shadow-lg border">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">{t('title')}</CardTitle>
          <CardDescription className="text-center">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {status === 'success' ? (
            <div className="space-y-4">
              {/* Alert sukcesu z wyśrodkowaniem i odpowiednimi kolorami */}
              <Alert className="items-center border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                {/* Nadpisujemy domyślne przesunięcie ikonki w dół z shadcn */}
                <Mail className="h-4 w-4 !translate-y-0" />
                {/* Nadpisujemy domyślny text-muted-foreground w AlertDescription */}
                <AlertDescription className="text-emerald-600 dark:text-emerald-400 font-medium">
                  {t('SUCCESS_PASSWORD_RESET_REQUESTED')}
                </AlertDescription>
              </Alert>
              <Button asChild className="w-full" variant="outline">
                <Link href="/login">{t('backToLogin')}</Link>
              </Button>
            </div>
          ) : (
            <Form {...form}>
              <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
                <FormField
                  control={form.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('emailLabel')}</FormLabel>
                      <FormControl>
                        <Input
                          placeholder="name@example.com"
                          {...field}
                          disabled={status === 'loading'}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" disabled={status === 'loading'}>
                  {status === 'loading' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {t('submitButton')}
                </Button>
                <div className="text-center text-sm">
                  <Link
                    href="/login"
                    className="text-muted-foreground hover:text-primary underline underline-offset-4"
                  >
                    {t('backToLogin')}
                  </Link>
                </div>
              </form>
            </Form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
