'use client';

import {
  Badge,
  Button,
  Card,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { ArrowUpDown, Layers, Pencil, Search, Trash2, X } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { ReportQuestionDialog } from '@/components/question-reports/report-question-dialog';
import type { Question } from '@/server/models/question.model';

interface QuestionTableProps {
  questions: Question[];
  isLoading: boolean;
  search: string;
  onSearchChange: (value: string) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  sortBy: string;
  sortOrder: string;
  onSortChange: (sortBy: string, sortOrder: string) => void;
  onEdit: (question: Question) => void;
  onDelete: (id: string) => void;
  onCreateFlashcard?: (question: Question) => void;
  showReportButton?: boolean;
  t: ReturnType<typeof useTranslations>;
}

export function QuestionTable({
  questions,
  isLoading,
  search,
  onSearchChange,
  typeFilter,
  onTypeFilterChange,
  sortBy,
  sortOrder,
  onSortChange,
  onEdit,
  onDelete,
  onCreateFlashcard,
  showReportButton = false,
  t,
}: QuestionTableProps) {
  const filtered = questions.filter((q) => {
    const matchesSearch = q.content.toLowerCase().includes(search.toLowerCase());
    const matchesType = typeFilter === 'all' || q.type === typeFilter;
    return matchesSearch && matchesType;
  });

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'content') return a.content.localeCompare(b.content) * dir;
    if (sortBy === 'type') return a.type.localeCompare(b.type) * dir;
    if (sortBy === 'created_at')
      return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir;
    return 0;
  });

  function toggleSort(field: string) {
    if (sortBy === field) {
      onSortChange(field, sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      onSortChange(field, 'asc');
    }
  }

  function SortHeader({ field, label }: { field: string; label: string }) {
    const isActive = sortBy === field;
    return (
      <TableHead className="cursor-pointer select-none" onClick={() => toggleSort(field)}>
        <div className="flex items-center gap-1">
          {label}
          <ArrowUpDown
            className={`h-3 w-3 ${isActive ? 'text-primary' : 'text-muted-foreground/50'}`}
          />
        </div>
      </TableHead>
    );
  }

  if (isLoading) {
    return (
      <Card>
        <div className="p-8 text-center text-muted-foreground">{t('common_loading')}</div>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={t('search_placeholder')}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select value={typeFilter} onValueChange={onTypeFilterChange}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('common_all')}</SelectItem>
            <SelectItem value="mcq">{t('mcq')}</SelectItem>
            <SelectItem value="true_false">{t('true_false_label')}</SelectItem>
            <SelectItem value="open">{t('open_label')}</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card className="p-0 gap-0">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader field="content" label={t('question')} />
              <SortHeader field="type" label={t('type')} />
              <TableHead>{t('topics')}</TableHead>
              <TableHead>{t('answers')}</TableHead>
              <TableHead className="text-right">{t('actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((q) => (
              <TableRow key={q.id}>
                <TableCell className="max-w-md truncate font-medium">{q.content}</TableCell>
                <TableCell>
                  <Badge variant="secondary">
                    {q.type === 'mcq'
                      ? t('mcq')
                      : q.type === 'true_false'
                        ? t('true_false_label')
                        : t('open_label')}
                  </Badge>
                </TableCell>
                <TableCell>
                  <div className="flex gap-1 flex-wrap">
                    {q.topics && q.topics.length > 0 ? (
                      q.topics.map((topic) => (
                        <Badge key={topic.id || topic.name} variant="outline" className="text-xs">
                          {topic.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell>{q.question_answers?.length ?? 0}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    {showReportButton ? (
                      <ReportQuestionDialog questionId={q.id} />
                    ) : (
                      <>
                        {onCreateFlashcard && (
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('create_flashcard_title')}
                            onClick={() => onCreateFlashcard(q)}
                          >
                            <Layers className="h-4 w-4" />
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => onEdit(q)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => onDelete(q.id)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t('no_questions')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
