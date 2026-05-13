'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from '@/lib/zod';
import { Copy, PlusCircle, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { CreateUniversitySchema } from '@/server/models/university.model';
import { CreateInviteSchema } from '@/server/models/invitation.model';
import { UserRole } from '@/types';
import { AppError } from '@/lib/errors';

export default function SysAdminDashboard() {
  const t = useTranslations('AdminPage');
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const formUniversity = useForm<z.infer<typeof CreateUniversitySchema>>({
    resolver: zodResolver(CreateUniversitySchema),
    defaultValues: { name: '', slug: '' },
  });

  const formInvite = useForm<z.infer<typeof CreateInviteSchema>>({
    resolver: zodResolver(CreateInviteSchema),
    defaultValues: { email: '', role: UserRole.UNIVERSITY_ADMIN, universityId: '' },
  });

  async function onSubmitUniversity(values: z.infer<typeof CreateUniversitySchema>) {
    try {
      const res = await fetch('/api/v1/admin/universities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });

      if (!res.ok) {
        if (res.status == 409) throw new AppError('CONFLICT');
        throw new AppError('INTERNAL_SERVER');
      }

      const data = await res.json();

      toast.success(t('success_university'), {
        description: t('success_university_desc', { id: data.id }),
      });

      formInvite.setValue('universityId', data.id);
      formUniversity.reset();
    } catch (error: unknown) {
      if (error instanceof AppError) {
        toast.error(t('error_unknown'), { description: error.message });
      } else {
        toast.error(t('error_unknown'), { description: t('error_unknown_desc') });
      }
    }
  }

  async function onSubmitInvite(values: z.infer<typeof CreateInviteSchema>) {
    setInviteLink(null);
    try {
      const payload = {
        ...values,
        universityId: values.universityId === '' ? undefined : values.universityId,
      };

      const res = await fetch('/api/v1/university/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error('Failed to send invitation');

      const data = await res.json();
      if (data.inviteLink) {
        setInviteLink(data.inviteLink);
      }

      toast.success(t('success_invite'), { description: t('success_invite_desc') });
      formInvite.reset({
        name: '',
        email: '',
        role: UserRole.UNIVERSITY_ADMIN,
        universityId: payload.universityId,
      });
    } catch (error: unknown) {
      if (error instanceof AppError) {
        toast.error(t('error_unknown'), { description: error.message });
      } else {
        toast.error(t('error_unknown'), { description: t('error_unknown_desc') });
      }
    }
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-8">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlusCircle className="w-5 h-5" /> {t('add_university')}
            </CardTitle>
            <CardDescription>{t('add_university_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...formUniversity}>
              <form
                onSubmit={formUniversity.handleSubmit(onSubmitUniversity)}
                className="space-y-4"
              >
                <FormField
                  control={formUniversity.control}
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
                  control={formUniversity.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('slug_label')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('slug_placeholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full">
                  {t('submit_university')}
                </Button>
              </form>
            </Form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Send className="w-5 h-5" /> {t('send_invite')}
            </CardTitle>
            <CardDescription>{t('send_invite_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <Form {...formInvite}>
              <form onSubmit={formInvite.handleSubmit(onSubmitInvite)} className="space-y-4">
                <FormField
                  control={formInvite.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('invite_name_label')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('invite_name_placeholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formInvite.control}
                  name="email"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('invite_email_label')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('invite_email_placeholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formInvite.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('role_label')}</FormLabel>
                      <Select onValueChange={field.onChange} defaultValue={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue placeholder={t('role_label')} />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value={UserRole.UNIVERSITY_ADMIN}>
                            {t('university_admin')}
                          </SelectItem>
                          <SelectItem value={UserRole.TEACHER}>{t('teacher')}</SelectItem>
                          <SelectItem value={UserRole.STUDENT}>{t('student')}</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={formInvite.control}
                  name="universityId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>{t('university_id_label')}</FormLabel>
                      <FormControl>
                        <Input placeholder={t('university_id_placeholder')} {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <Button type="submit" className="w-full" variant="secondary">
                  {t('submit_invite')}
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
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
