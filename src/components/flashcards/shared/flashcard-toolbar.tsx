'use client';

import { Lock, Plus, Search, Sparkles, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useFeature } from '@/hooks/use-feature';
import type { Topic } from '@/types/flashcards';

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
  onGenerate,
  onCreateNew,
  t,
}: FlashcardToolbarProps) {
  const router = useRouter();
  const { hasAccess: hasStudyAccess } = useFeature('study.create');
  const { hasAccess: hasAiAccess } = useFeature('ai.chat');
  const hasAccessGenerate = hasStudyAccess && hasAiAccess;

  return (
    <div className="flex flex-wrap items-center gap-3 max-sm:hidden">
      <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={searchInput}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder={t('search_placeholder')}
          className="pl-9 pr-9"
        />
        {searchInput && (
          <button
            onClick={() => onSearchChange('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>
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
      <div className="flex items-center gap-2 sm:ml-auto">
        {canGenerate && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={!hasAccessGenerate}
            onClick={
              hasAccessGenerate
                ? onGenerate
                : () => router.push('/checkout?plan_id=student_premium')
            }
          >
            {hasAccessGenerate ? (
              <>
                <Sparkles className="h-4 w-4" /> {t('generate')}
              </>
            ) : (
              <>
                <Lock className="size-3" /> Upgrade
              </>
            )}
          </Button>
        )}
        <Button
          size="sm"
          className="gap-1.5"
          disabled={!hasStudyAccess}
          onClick={
            hasStudyAccess ? onCreateNew : () => router.push('/checkout?plan_id=student_premium')
          }
        >
          {hasStudyAccess ? (
            <>
              <Plus className="h-4 w-4" /> {t('new_flashcard')}
            </>
          ) : (
            <>
              <Lock className="size-3" /> Upgrade
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
