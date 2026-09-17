'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { APP_ERRORS } from '@studiq/server/lib/errors';
import { type UpdatePasswordInput, updatePasswordSchema } from '@studiq/server/models/auth.model';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  Input,
} from '@studiq/ui';
import { Loader2, Lock } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function PasswordUpdatePage() {
  const t = useTranslations('PasswordUpdatePage');
  const tErr = useTranslations('Errors');
  const router = useRouter();

  const form = useForm<UpdatePasswordInput>({
    resolver: zodResolver(updatePasswordSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const isLoading = form.formState.isSubmitting;

  async function onSubmit(data: UpdatePasswordInput) {
    try {
      const response = await fetch('/api/v1/auth/password/update', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      const result = await response.json();

      if (!result.success) {
        toast.error(tErr(result.error || APP_ERRORS.UNPROCESSABLE_ENTITY.code));
        return;
      }

      toast.success(t('SUCCESS_PASSWORD_UPDATED'));

      router.push('/dashboard');
      router.refresh();
    } catch {
      toast.error(tErr(APP_ERRORS.INTERNAL_SERVER.code));
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md shadow-lg border-sidebar-border bg-sidebar">
        <CardHeader className="space-y-1">
          <CardTitle className="text-2xl text-center">{t('title')}</CardTitle>
          <CardDescription className="text-center">{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <FormField
                control={form.control}
                name="password"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('new_password_label')}</FormLabel>
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
              <FormField
                control={form.control}
                name="confirmPassword"
                render={({ field, fieldState }) => (
                  <FormItem>
                    <FormLabel>{t('confirm_password_label')}</FormLabel>
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
              <Button type="submit" className="w-full flex items-center gap-2" disabled={isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('submit_button')}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
