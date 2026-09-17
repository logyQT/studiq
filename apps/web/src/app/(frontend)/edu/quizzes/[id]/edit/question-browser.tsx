'use client';

import { useDraggable } from '@dnd-kit/core';
import { Badge, Input } from '@studiq/ui';
import { GripVertical, Plus } from 'lucide-react';
import { type ChangeEvent, useState } from 'react';
import { useApiQuery } from '@/hooks/use-api';

interface BrowseQuestion {
  id: string;
  content: string;
  type: string;
}

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
        title="Add to quiz"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

export function QuestionBrowser({ existingIds, onAdd, draggable = false }: QuestionBrowserProps) {
  const [search, setSearch] = useState('');
  const [selectedBankId, setSelectedBankId] = useState<string | undefined>();

  const { data: banksData } = useApiQuery<{ items: Array<{ id: string; name: string }> }>({
    queryKey: ['question-banks'],
    url: '/api/v1/questions/banks',
  });
  const banks = banksData?.items;

  const { data: questions } = useApiQuery<BrowseQuestion[]>({
    queryKey: ['questions', selectedBankId ?? 'all'],
    url: selectedBankId
      ? `/api/v1/questions?bankId=${selectedBankId}${search ? `&search=${search}` : ''}`
      : `/api/v1/questions${search ? `?search=${search}` : ''}`,
  });

  const allQuestions = (questions ?? []).filter((q) => !existingIds.has(q.id));
  const filtered = search
    ? allQuestions.filter((q) => q.content.toLowerCase().includes(search.toLowerCase()))
    : allQuestions;

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
          <option value="">All banks</option>
          {(banks ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <Input
          placeholder="Search questions..."
          value={search}
          onChange={(e: ChangeEvent<HTMLInputElement>) => {
            setSearch(e.target.value);
          }}
        />
      </div>

      <div className="space-y-2 max-h-[60vh] overflow-y-auto">
        {filtered.map((q) => (
          <BrowserItem key={q.id} question={q} onAdd={(q) => onAdd([q])} draggable={draggable} />
        ))}
        {filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">No questions found</p>
        )}
      </div>
    </div>
  );
}
