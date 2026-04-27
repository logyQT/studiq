'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { LoginSchema, type LoginInput } from '@/server/models/user.model';
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
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { cn } from '@/lib/utils';

import { Mail, Lock, LogIn } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const t = useTranslations('LoginPage');

  const form = useForm<LoginInput>({
    resolver: zodResolver(LoginSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  async function onSubmit(values: LoginInput) {
    try {
      const response = await fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(values),
      });

      if (!response.ok) throw new Error('Błędne dane logowania');

      toast.success('Zalogowano pomyślnie!');
      router.push('/dashboard');
    } catch (error) {
      toast.error('Wystąpił błąd podczas logowania');
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/50 p-6">
      <div className="w-full max-w-md space-y-8 bg-background p-8 rounded-xl shadow-lg border">
        {/* HEADER */}
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">{t('header')}</h1>
          <p className="text-sm text-muted-foreground">{t('sub_header')}</p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            {/* EMAIL */}
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
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage translator={t} />
                </FormItem>
              )}
            />

            {/* PASSWORD */}
            <FormField
              control={form.control}
              name="password"
              render={({ field, fieldState }) => (
                <FormItem>
                  <FormLabel>{t('password_label')}</FormLabel>
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
                        {...field}
                      />
                    </div>
                  </FormControl>
                  <FormMessage translator={t} />
                </FormItem>
              )}
            />

            {/* FORGOT PASSWORD */}
            <div className="flex justify-end -mt-2">
              <Link href="/forgot-password" className="text-sm text-primary hover:underline">
                {t('forgot_password')}
              </Link>
            </div>

            {/* SUBMIT */}
            <Button
              type="submit"
              className="w-full flex items-center gap-2"
              disabled={form.formState.isSubmitting}
            >
              <LogIn size={18} />
              {form.formState.isSubmitting ? '...' : t('login_button')}
            </Button>

            {/* DIVIDER */}
            {/* <div className="flex items-center gap-4">
              <div className="flex-1 h-px bg-border" />
              <span className="text-xs text-muted-foreground">OR</span>
              <div className="flex-1 h-px bg-border" />
            </div> */}

            {/* OAUTH */}
            {/* <div className="grid grid-cols-2 gap-3">
              <Button variant="outline">Google</Button>
              <Button variant="outline">GitHub</Button>
            </div> */}
          </form>
        </Form>

        {/* REGISTER */}
        <p className="text-center text-sm text-muted-foreground">
          {t('no_account')}{' '}
          <Link href="/register" className="text-primary hover:underline">
            {t('register_link')}
          </Link>
        </p>
      </div>
    </div>
  );
}
