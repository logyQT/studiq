'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Textarea,
} from '@studiq/ui';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { PlanLockedCard } from '@/components/shared/plan-locked-card';
import { useApiMutation } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { useFeatures } from '@/hooks/use-features';
import { apiPost } from '@/lib/api';
import { quizKeys } from '@/lib/query-keys';

export function NewQuizClient() {
  const t = useTranslations('EduQuizNewPage');
  const router = useRouter();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');

  // Creating a quiz is a `quiz.templates` write (phase 5d): unentitled, the
  // plan card replaces the form. The pending features query keeps the
  // skeleton up so an entitled teacher never flashes the locked card.
  const canTemplates = useFeature()('quiz.templates');
  const { isPending: featuresPending } = useFeatures();

  const createMutation = useApiMutation<{ id: string }, { name: string; description?: string }>({
    mutationFn: async (data) => apiPost<{ id: string }>('/api/v1/teacher/quizzes', data),
    invalidateKeys: [quizKeys.all],
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const data = await createMutation.mutateAsync({
      name: trimmedName,
      description: description || undefined,
    });
    router.push(`/edu/quizzes/${data.id}/edit`);
  };

  if (featuresPending) {
    return (
      <div className="p-6 max-w-2xl mx-auto space-y-6">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-64 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('subtitle')}</p>
      </div>

      {!canTemplates ? (
        <PlanLockedCard
          title={t('locked_title')}
          description={t('locked_desc')}
          cta={t('locked_cta')}
        />
      ) : (
        <form onSubmit={handleSubmit}>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t('title')}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('name_field')}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t('name_placeholder')}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="description">{t('description')}</Label>
                <Textarea
                  id="description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('description_placeholder')}
                  rows={3}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end gap-3 mt-6">
            <Button type="button" variant="outline" onClick={() => router.push('/edu/quizzes')}>
              {t('cancel')}
            </Button>
            <Button type="submit" disabled={!name.trim() || createMutation.isPending}>
              {createMutation.isPending ? t('creating') : t('create')}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
