'use client';

import type { Question } from '@studiq/server/models/question.model';
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
import {
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  Layers,
  Pencil,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { ReportQuestionDialog } from '@/components/question-reports/report-question-dialog';
import { resolveListEmptyView } from '@/lib/list-empty-view';

interface QuestionTableProps {
  /** The current page, already searched, filtered and sorted by the server. */
  questions: Question[];
  isLoading: boolean;
  /** A page change or a filter is in flight: the previous rows stay visible, dimmed. */
  isFetching?: boolean;
  total: number;
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
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
  canUpdate: (question: Question) => boolean;
  canDelete: (question: Question) => boolean;
  /** Additionally offer the report action; it never replaces the authoring actions. */
  showReportButton?: boolean;
  /** Replaces the default empty state, e.g. when the viewer cannot add questions. */
  emptyText?: string;
  /** The list failed to load: say so, never "nothing here yet, create the first one". */
  isError?: boolean;
  onRetry: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function QuestionTable({
  questions,
  isLoading,
  isFetching = false,
  total,
  page,
  pageSize,
  onPageChange,
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
  canUpdate,
  canDelete,
  showReportButton = false,
  emptyText,
  isError = false,
  onRetry,
  t,
}: QuestionTableProps) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  // One rule for every list (#666): a filter that hid every row says so, and never reuses the
  // "nothing here yet, create the first one" copy — not even the read-only variant of it.
  const emptyView = resolveListEmptyView({
    visibleCount: questions.length,
    query: search,
    activeFilters: typeFilter === 'all' ? 0 : 1,
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
            maxLength={100}
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

      <Card className={`p-0 gap-0 transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
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
            {questions.map((q) => (
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
                    {onCreateFlashcard && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('create_flashcard_title')}
                        aria-label={t('create_flashcard_title')}
                        onClick={() => onCreateFlashcard(q)}
                      >
                        <Layers className="h-4 w-4" />
                      </Button>
                    )}
                    {canUpdate(q) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('common_edit')}
                        aria-label={t('common_edit')}
                        onClick={() => onEdit(q)}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                    {canDelete(q) && (
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t('common_delete')}
                        aria-label={t('common_delete')}
                        onClick={() => onDelete(q.id)}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    {showReportButton && <ReportQuestionDialog questionId={q.id} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {questions.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {isError ? (
                    // The body of the table still carries the failure, so the card keeps its
                    // shape instead of ending on the header row, and retry stays where the
                    // missing rows were.
                    <div role="alert" className="flex flex-wrap items-center justify-center gap-3">
                      <span>{t('load_error')}</span>
                      <Button variant="outline" size="sm" onClick={onRetry}>
                        {t('retry')}
                      </Button>
                    </div>
                  ) : emptyView.kind === 'no-results' ? (
                    t('no_results')
                  ) : (
                    (emptyText ?? t('no_questions'))
                  )}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      {total > 0 && (
        <nav
          className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground"
          aria-label={t('pagination')}
        >
          <span>{t('total_count', { count: total })}</span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              aria-label={t('previous_page')}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>{t('page_of', { page, pages: pageCount })}</span>
            <Button
              variant="outline"
              size="icon"
              disabled={page >= pageCount}
              onClick={() => onPageChange(page + 1)}
              aria-label={t('next_page')}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </nav>
      )}
    </div>
  );
}
