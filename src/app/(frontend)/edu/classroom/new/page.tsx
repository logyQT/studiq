'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Loader2, School } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useForm } from 'react-hook-form';
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
import { useCreateClassroom } from '@/hooks/use-create-classroom';
import { z } from '@/lib/zod';

const CreateClassroomFormSchema = z.object({
  name: z.string().nonempty().min(2).max(64),
  slug: z
    .string()
    .regex(/^[a-z0-9-]+$/)
    .min(2)
    .max(24)
    .optional()
    .or(z.literal('')),
});

export default function NewClassroomPage() {
  const t = useTranslations('NewClassroomPage');
  const createClassroom = useCreateClassroom();

  const form = useForm<z.infer<typeof CreateClassroomFormSchema>>({
    resolver: zodResolver(CreateClassroomFormSchema),
    defaultValues: { name: '', slug: '' },
  });

  async function onSubmit(values: z.infer<typeof CreateClassroomFormSchema>) {
    await createClassroom.mutateAsync({
      name: values.name,
      slug: values.slug || undefined,
    });
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
              <School className="size-5 text-primary" />
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
              <Button type="submit" className="w-full" disabled={createClassroom.isPending}>
                {createClassroom.isPending && <Loader2 className="size-4 mr-2 animate-spin" />}
                {t('submit')}
              </Button>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
