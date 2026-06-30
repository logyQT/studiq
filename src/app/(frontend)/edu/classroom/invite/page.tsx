'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Copy, Loader2, Send } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
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
import { z } from '@/lib/zod';
import { UserRole } from '@/types';

const InviteFormSchema = z.object({
  name: z.string().nonempty().min(1).max(100),
  email: z.string().email(),
});

export default function ClassroomInvitePage() {
  const t = useTranslations('ClassroomInvitePage');
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [isPending, setIsPending] = useState(false);

  const form = useForm<z.infer<typeof InviteFormSchema>>({
    resolver: zodResolver(InviteFormSchema),
    defaultValues: { name: '', email: '' },
  });

  async function onSubmit(values: z.infer<typeof InviteFormSchema>) {
    setIsPending(true);
    setInviteLink(null);
    try {
      const res = await fetch('/api/v1/organization/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, role: UserRole.STUDENT }),
      });

      if (!res.ok) throw new Error('Failed to send invitation');

      const data = await res.json();
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
      }
      toast.success(t('success'));
      form.reset();
    } catch {
      toast.error('Failed to send invitation');
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="max-w-lg mx-auto pt-12">
      <Link
        href="/edu"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
      >
        <ArrowLeft className="size-4" />
        {t('back')}
      </Link>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-2">
              <Send className="size-5 text-primary" />
            </div>
            <div>
              <CardTitle>{t('title')}</CardTitle>
              <CardDescription>{t('description')}</CardDescription>
            </div>
          </div>
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
                      <Input placeholder={t('name_placeholder')} {...field} />
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
                      <Input type="email" placeholder={t('email_placeholder')} {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <Button type="submit" className="w-full" disabled={isPending}>
                {isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                {t('submit')}
              </Button>
            </form>
          </Form>

          {inviteLink && (
            <div className="mt-6 p-4 bg-muted rounded-md border border-border">
              <p className="text-sm font-medium mb-2">{t('invite_link_label')}</p>
              <div className="flex gap-2">
                <Input readOnly value={inviteLink} className="text-xs font-mono" />
                <Button
                  size="icon"
                  variant="outline"
                  onClick={() => {
                    navigator.clipboard.writeText(inviteLink);
                    toast.success(t('copied'), { description: t('copied_desc') });
                  }}
                >
                  <Copy className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
