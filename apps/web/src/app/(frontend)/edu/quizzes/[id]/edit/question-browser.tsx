'use client';

import { useDraggable } from '@dnd-kit/core';
import { Badge, Input } from '@studiq/ui';
import { GripVertical, Plus, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { type ChangeEvent, useState } from 'react';
import { EmptyState, ErrorState } from '@/components/shared/empty-state';
import { useApiQuery } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { availableQuestions, type BrowseQuestion } from '@/lib/question-browser';
import { shouldRetryQuery } from '@/lib/query-retry';

interface QuestionBrowserProps {
  existingIds: Set<string>;
  onAdd: (questions: BrowseQuestion[]) => void;
  draggable?: boolean;
}

function BrowserItem({
  question,
  onAdd,
  draggable,
}: {
  question: BrowseQuestion;
  onAdd: (q: BrowseQuestion) => void;
  draggable: boolean;
}) {
  const t = useTranslations('EduQuizEditPage');
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `browser-${question.id}`,
    data: { source: 'browser', question },
    disabled: !draggable,
  });

  return (
    <div
      ref={setNodeRef}
      style={draggable && isDragging ? { opacity: 0.5 } : undefined}
      className="rounded-lg border p-3 flex items-start gap-3 bg-card hover:bg-accent/50"
    >
      {draggable && (
        <button
          {...attributes}
          {...listeners}
          className="mt-1 cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
        >
          <GripVertical className="w-4 h-4" />
        </button>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-sm">{question.content}</p>
        <Badge variant="outline" className="mt-1 text-xs">
          {question.type.replace('_', ' ')}
        </Badge>
      </div>
      <button
        type="button"
        onClick={() => onAdd(question)}
        className="text-muted-foreground hover:text-primary shrink-0"
        title={t('add_to_quiz')}
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export function QuestionBrowser({ existingIds, onAdd, draggable = false }: QuestionBrowserProps) {
  const t = useTranslations('EduQuizEditPage');
  const [search, setSearch] = useState('');
  const [selectedBankId, setSelectedBankId] = useState<string | undefined>();

  const { data: banksData } = useApiQuery<{ items: Array<{ id: string; name: string }> }>({
    queryKey: ['question-banks'],
    url: '/api/v1/questions/banks',
  });
  const banks = banksData?.items;

  // The server filters by the search term, so the term is part of the cache key (otherwise a
  // list filtered by one term is served for another) and of the URL through URLSearchParams
  // (a raw `&`, `#`, `+` or `%` in the text would corrupt the query).
  const debouncedSearch = useDebounce(search.trim(), 300);
  const params = new URLSearchParams();
  if (selectedBankId) params.set('bankId', selectedBankId);
  if (debouncedSearch) params.set('search', debouncedSearch);
  const queryString = params.toString();

  const {
    data: questions,
    isError: questionsError,
    refetch: refetchQuestions,
  } = useApiQuery<BrowseQuestion[]>({
    queryKey: ['questions', selectedBankId ?? 'all', debouncedSearch],
    url: `/api/v1/questions${queryString ? `?${queryString}` : ''}`,
    retry: shouldRetryQuery,
  });

  // The server is the only place that filters: a second pass over the returned rows with the
  // raw input hid rows the API had matched (trimmed term, `*` as a wildcard).
  const allQuestions = availableQuestions(questions, existingIds);

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <select
          className="w-full border rounded-md px-3 py-2 text-sm bg-background"
          value={selectedBankId || ''}
          onChange={(e: ChangeEvent<HTMLSelectElement>) => {
            setSelectedBankId(e.target.value || undefined);
          }}
        >
          <option value="">{t('all_banks')}</option>
          {(banks ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <Input
          placeholder={t('search_questions_placeholder')}
          maxLength={100}
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
          }}
        />
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {questionsError ? (
          // A failed request is not "no question matches": name the failure and offer a retry,
          // like every other list on the app.
          <ErrorState onRetry={() => refetchQuestions()} compact />
        ) : (
          <>
            {allQuestions.map((q) => (
              <BrowserItem
                key={q.id}
                question={q}
                onAdd={(q) => onAdd([q])}
                draggable={draggable}
              />
            ))}
            {allQuestions.length === 0 && (
              // The same shape as the error state and the other lists: icon, text, no dead end.
              <EmptyState icon={SearchX} title={t('no_questions_found')} compact />
            )}
          </>
        )}
      </div>
    </div>
  );
}
