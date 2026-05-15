'use client';

import { useEffect, useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';

import { RegisterSchema, RegisterInput } from '@/server/models/auth.model';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { APP_ERRORS } from '@/lib/errors';

function JoinSkeleton() {
  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader className="space-y-2">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-10 w-full" />
        </div>
        <Skeleton className="h-10 w-full mt-4" />
        <div className="flex items-center justify-center gap-2 pt-2">
          <Spinner className="h-4 w-4" />
          <span className="text-sm text-muted-foreground">Verifying invitation...</span>
        </div>
      </CardContent>
    </Card>
  );
}

function JoinContent() {
  const t = useTranslations('RegisterPage');
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [isVerifying, setIsVerifying] = useState(true);

  const form = useForm<RegisterInput>({
    resolver: zodResolver(RegisterSchema),
    defaultValues: {
      name: '',
      email: '',
      password: '',
      inviteToken: token || '',
    },
  });

  useEffect(() => {
    if (!token) {
      router.replace('/register');
      return;
    }

    async function verifyToken() {
      try {
        const res = await fetch(`/api/v1/university/invitations?token=${token}`);
        const result = await res.json();

        if (!res.ok || !result.success) {
          toast.error(APP_ERRORS.BAD_REQUEST.code);
          router.replace('/register');
          return;
        }

        form.setValue('email', result.data.email);
        form.setValue('name', result.data.name);
      } catch {
        toast.error(APP_ERRORS.INTERNAL_SERVER.code);
        router.replace('/register');
      } finally {
        setIsVerifying(false);
      }
    }

    verifyToken();
  }, [token, router, form]);

  async function onSubmit(values: RegisterInput) {
    try {
      const res = await fetch('/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'ERROR_REGISTRATION_FAILED');
      }

      toast.success(t('success_header'), {
        description: t('SUCCESS_ACTIVATION_LINK_SENT'),
      });

      router.push('/login');
    } catch {
      toast.error(t('Errors.ERROR_INTERNAL_SERVER'));
    }
  }

  // Show Skeleton while fetching invitation details
  if (isVerifying) {
    return <JoinSkeleton />;
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle>{t('join_title')}</CardTitle>
        <CardDescription>{t('join_desc')}</CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('name_label')}</FormLabel>
                  <FormControl>
                    <Input {...field} readOnly className="bg-muted cursor-not-allowed" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('email_label')}</FormLabel>
                  <FormControl>
                    <Input {...field} readOnly className="bg-muted cursor-not-allowed" />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>{t('password_label')}</FormLabel>
                  <FormControl>
                    <Input type="password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <Button type="submit" className="w-full">
              {t('activate_account')}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
}

export default function JoinPage() {
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Suspense fallback={<JoinSkeleton />}>
        <JoinContent />
      </Suspense>
    </div>
  );
}
