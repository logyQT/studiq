'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Check, Loader2, Plus, School, Users, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { z } from '@/lib/zod';

const ClassroomFormSchema = z.object({
  name: z
    .string()
    .nonempty('VALIDATION_REQUIRED')
    .min(3, 'VALIDATION_TOO_SHORT')
    .max(64, 'VALIDATION_TOO_LONG'),
  invites: z.array(
    z.object({
      email: z.email(),
    }),
  ),
});

type ClassroomFormValues = z.infer<typeof ClassroomFormSchema>;

export default function ClassroomPage() {
  const t = useTranslations('SetupPage');
  const router = useRouter();
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  const form = useForm<ClassroomFormValues>({
    resolver: zodResolver(ClassroomFormSchema),
    defaultValues: {
      name: '',
      invites: [],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control: form.control,
    name: 'invites',
  });

  const watchedName = form.watch('name');
  const watchedInvites = form.watch('invites');
  const validInvites = (watchedInvites ?? []).filter((i) => i.email.trim());

  async function handleCreate() {
    const values = form.getValues();
    setLoading(true);
    try {
      const res = await fetch('/api/v1/organization', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: values.name }),
      });

      if (!res.ok) throw new Error();

      const orgBody = await res.json();
      const memberRoleId = orgBody.data?.memberRoleId as string | undefined;
      if (!memberRoleId) throw new Error();

      const filtered = values.invites.filter((i) => i.email.trim());
      if (filtered.length > 0) {
        const bulkRes = await fetch('/api/v1/organization/invites/bulk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invitations: filtered.map((i) => ({
              email: i.email,
              targetOrgRoleId: memberRoleId,
            })),
          }),
        });

        if (!bulkRes.ok) throw new Error();
      }

      setDone(true);
    } catch {
      toast.error(t('create_failed'));
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="text-center space-y-4 py-8">
        <Check className="size-12 mx-auto text-primary" />
        <h2 className="text-xl font-semibold">{t('done_title')}</h2>
        <p className="text-muted-foreground">{t('done_message')}</p>
        <Button onClick={() => router.push('/edu')} className="w-full max-w-sm mx-auto">
          {t('go_to_dashboard')}
        </Button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_1fr] gap-y-8">
      {/* Left: Form */}
      <div className="lg:pr-8">
        <div className="space-y-8">
          <div>
            <h1 className="text-2xl font-bold">{t('create_title')}</h1>
            <p className="text-muted-foreground mt-1">{t('create_desc')}</p>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(handleCreate)} className="space-y-8">
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

              <Separator />

              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold">{t('invites_title')}</h2>
                  <p className="text-sm text-muted-foreground">{t('invites_desc')}</p>
                </div>

                <div className="space-y-2">
                  {fields.map((item, index) => (
                    <div key={item.id} className="flex items-center gap-2">
                      <FormField
                        control={form.control}
                        name={`invites.${index}.email`}
                        render={({ field }) => (
                          <FormItem className="flex-1">
                            <FormControl>
                              <Input placeholder={t('email_placeholder')} type="email" {...field} />
                            </FormControl>
                          </FormItem>
                        )}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => remove(index)}
                      >
                        <X className="size-4" />
                      </Button>
                    </div>
                  ))}
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => append({ email: '' })}
                >
                  <Plus className="size-4 mr-1" />
                  {t('add_member')}
                </Button>
              </div>

              <Separator className="lg:hidden" />

              <Button type="submit" className="w-full" disabled={loading}>
                {loading && <Loader2 className="size-4 mr-2 animate-spin" />}
                {t('create_button')}
              </Button>
            </form>
          </Form>
        </div>
      </div>

      {/* Divider */}
      <div className="hidden lg:block w-px bg-border" />

      {/* Right: Preview */}
      <div className="lg:pl-8">
        <div className="lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle>{t('preview_title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <School className="size-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{t('name_label')}</p>
                  <p className="font-medium">
                    {watchedName || <span className="text-muted-foreground italic">&mdash;</span>}
                  </p>
                </div>
              </div>

              <Separator />

              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2">
                  <Users className="size-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground">
                    {validInvites.length > 0
                      ? `${validInvites.length + 1} ${t('members_count')}`
                      : `1 ${t('members_count')}`}
                  </p>
                  <ul className="mt-2 space-y-1">
                    <li className="flex items-center gap-2 text-sm">
                      <span className="size-1.5 rounded-full bg-primary shrink-0" />
                      <span className="font-medium">{t('you')}</span>
                      <span className="text-xs text-muted-foreground">({t('role_admin')})</span>
                    </li>
                    {validInvites.map((inv, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        <span className="size-1.5 rounded-full bg-muted-foreground shrink-0" />
                        <span className="truncate">{inv.email}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
