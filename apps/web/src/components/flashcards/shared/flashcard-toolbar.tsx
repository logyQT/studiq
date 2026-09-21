'use client';

import type { Topic } from '@studiq/server/models/topic.model';
import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@studiq/ui';
import { Plus, Sparkles } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { PageToolbar } from '@/components/shared/page-toolbar';
import { useFeature } from '@/hooks/use-feature';
import { usePermission } from '@/hooks/use-permission';

interface FlashcardToolbarProps {
  searchInput: string;
  onSearchChange: (value: string) => void;
  topicFilter: string;
  onTopicFilterChange: (value: string) => void;
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  topics: Topic[];
  canGenerate: boolean;
  canAddCard?: boolean;
  onGenerate: () => void;
  onCreateNew: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function FlashcardToolbar({
  searchInput,
  onSearchChange,
  topicFilter,
  onTopicFilterChange,
  sortBy,
  sortOrder,
  onSortChange,
  topics,
  canGenerate,
  canAddCard,
  onGenerate,
  onCreateNew,
  t,
}: FlashcardToolbarProps) {
  const { user } = useAuth();
  const permission = usePermission();
  const feature = useFeature();
  const canCreate = permission('flashcard.create', { createdBy: user?.id });
  const hasAiAccess = feature('ai.chat');
  const hasAccessGenerate = canCreate && hasAiAccess;

  return (
    <PageToolbar
      search={{
        value: searchInput,
        onChange: onSearchChange,
        placeholder: t('search_placeholder'),
      }}
      actions={
        <>
          {canGenerate && hasAccessGenerate && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={onGenerate}>
              <Sparkles className="h-4 w-4" /> {t('generate')}
            </Button>
          )}
          {(canAddCard ?? canCreate) && (
            <Button size="sm" className="gap-1.5" onClick={onCreateNew}>
              <Plus className="h-4 w-4" /> {t('new_flashcard')}
            </Button>
          )}
        </>
      }
    >
      {topics.length > 0 && (
        <Select value={topicFilter} onValueChange={onTopicFilterChange}>
          <SelectTrigger className="w-40 truncate">
            <SelectValue placeholder={t('topic_all')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('topic_all')}</SelectItem>
            {topics.map((topic) => (
              <SelectItem key={topic.id} value={topic.id}>
                {topic.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      <Select
        value={`${sortBy}:${sortOrder}`}
        onValueChange={(v) => {
          const [sb, so] = v.split(':');
          onSortChange(sb, so);
        }}
      >
        <SelectTrigger className="w-40 truncate">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="created_at:desc">{t('sort_newest')}</SelectItem>
          <SelectItem value="created_at:asc">{t('sort_oldest')}</SelectItem>
          <SelectItem value="front:asc">{t('sort_name_asc')}</SelectItem>
          <SelectItem value="front:desc">{t('sort_name_desc')}</SelectItem>
        </SelectContent>
      </Select>
    </PageToolbar>
  );
}
