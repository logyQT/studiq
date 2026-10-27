'use client';

import type { PaginatedQuestions, Question } from '@studiq/server/models/question.model';
import type { QuestionBank } from '@studiq/server/models/question-bank.model';
import type { Topic } from '@studiq/server/models/topic.model';
import { Button } from '@studiq/ui';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, Plus } from 'lucide-react';
import Link from 'next/link';
import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { CreateFromQuestionDialog } from '@/components/flashcards/dialogs/create-from-question-dialog';
import { QuestionFormDialog } from '@/components/questions/shared/question-form-dialog';
import { QuestionTable } from '@/components/questions/shared/question-table';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { useApiQuery } from '@/hooks/use-api';
import { useBreadcrumbLabel } from '@/hooks/use-breadcrumbs';
import { useDebounce } from '@/hooks/use-debounce';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermission } from '@/hooks/use-permission';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { bankAccess } from '@/lib/bank-access';
import { questionKeys, topicKeys } from '@/lib/query-keys';
import { SrLabel } from '@/components/shared/sr-label';

const QUESTIONS_PAGE_SIZE = 25;

interface QuestionBankDetailScreenProps {
  bankId: string;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
  tForm: ReturnType<typeof useTranslations>;
}

export function QuestionBankDetailScreen({
  bankId,
  basePath,
  t,
  tForm,
}: QuestionBankDetailScreenProps) {
  const queryClient = useQueryClient();
  const permission = usePermission();
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [page, setPage] = useState(1);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [flashcardSourceQuestion, setFlashcardSourceQuestion] = useState<Question | null>(null);

  const { data: bank } = useQuery({
    queryKey: questionKeys.banks.detail(bankId),
    queryFn: () => apiGet<QuestionBank>(`/api/v1/questions/banks/${bankId}`),
    staleTime: Infinity,
  });

  const access = bankAccess(
    !!bank,
    !!bank &&
      permission('question_bank.update', {
        createdBy: bank.created_by,
        orgId: bank.organization_id ?? undefined,
      }),
  );

  // The bank name is the breadcrumb leaf; the raw bank UUID must never render.
  useBreadcrumbLabel(bankId, bank?.name);

  // Search, type filter, sort and paging all run on the server (#651); the typed text is
  // debounced so a request is not sent per keystroke, and the previous page stays on screen
  // while the next one loads.
  const debouncedSearch = useDebounce(search.trim(), 300);
  const listParams = {
    bankId,
    page: String(page),
    limit: String(QUESTIONS_PAGE_SIZE),
    search: debouncedSearch || undefined,
    type: typeFilter === 'all' ? undefined : typeFilter,
    sortBy,
    sortOrder,
  };
  const {
    data: questionsPage,
    isLoading: questionsLoading,
    isFetching: questionsFetching,
  } = useQuery({
    queryKey: questionKeys.list(listParams),
    queryFn: () => {
      const query = new URLSearchParams(
        Object.entries(listParams).filter((entry): entry is [string, string] => !!entry[1]),
      );
      return apiGet<PaginatedQuestions>(`/api/v1/questions?${query}`);
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
  const questions: Question[] = questionsPage?.items ?? [];
  const total = questionsPage?.total ?? 0;

  // Land on the last page that still exists after deleting the last row of a page.
  const lastPage = Math.max(1, Math.ceil(total / QUESTIONS_PAGE_SIZE));
  if (questionsPage && page > lastPage) setPage(lastPage);

  const { data: topicsData } = useApiQuery<{ items: Topic[] }>({
    queryKey: topicKeys.options(activeOrg?.id),
    url: '/api/v1/topics?limit=200',
    enabled: !orgsPending,
  });
  const topics = topicsData?.items ?? [];

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: questionKeys.list({ bankId }) });
    queryClient.invalidateQueries({ queryKey: questionKeys.banks.detail(bankId) });
    queryClient.invalidateQueries({ queryKey: questionKeys.banks.all });
  }

  async function handleSubmit(data: {
    content: string;
    type: string;
    explanation?: string;
    topicIds?: string[];
    bankId: string;
    answers: { content: string; isCorrect: boolean; orderIndex: number }[];
  }): Promise<boolean> {
    try {
      if (editingQuestion) {
        await apiPut(`/api/v1/questions/${editingQuestion.id}`, data);
        toast.success(tForm('updated'));
      } else {
        await apiPost('/api/v1/questions', data);
        toast.success(tForm('created'));
      }
    } catch {
      toast.error(tForm('save_failed'));
      return false;
    }
    invalidate();
    setDialogOpen(false);
    setEditingQuestion(null);
    return true;
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await apiDelete(`/api/v1/questions/${deleteId}`);
      toast.success(tForm('deleted'));
      invalidate();
    } catch {
      toast.error(tForm('delete_failed'));
    }
    setDeleteId(null);
  }

  function openCreate() {
    setEditingQuestion(null);
    setDialogOpen(true);
  }

  function openEdit(q: Question) {
    setEditingQuestion(q);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href={`${basePath}`}>
            <ArrowLeft className="h-4 w-4" />
            <SrLabel k="back" />
          </Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{bank?.name ?? t('title')}</h2>
          {bank?.description && (
            <p className="text-sm text-muted-foreground mt-1">{bank.description}</p>
          )}
        </div>
        {access.canCreateQuestion && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> {t('create_question')}
          </Button>
        )}
      </div>

      {access.readOnly && (
        <p
          role="note"
          className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
        >
          <Eye className="h-4 w-4 shrink-0" aria-hidden="true" />
          {t('read_only_notice')}
        </p>
      )}

      <QuestionTable
        questions={questions}
        isLoading={questionsLoading}
        isFetching={questionsFetching}
        total={total}
        page={page}
        pageSize={QUESTIONS_PAGE_SIZE}
        onPageChange={setPage}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setPage(1);
        }}
        typeFilter={typeFilter}
        onTypeFilterChange={(value) => {
          setTypeFilter(value);
          setPage(1);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(sb, so) => {
          setSortBy(sb);
          setSortOrder(so);
          setPage(1);
        }}
        onEdit={openEdit}
        onDelete={setDeleteId}
        onCreateFlashcard={basePath.startsWith('/edu') ? setFlashcardSourceQuestion : undefined}
        canUpdate={(q) =>
          access.allowQuestionAction(permission('question.update', { createdBy: q.created_by }))
        }
        canDelete={(q) =>
          access.allowQuestionAction(permission('question.delete', { createdBy: q.created_by }))
        }
        emptyText={access.readOnly ? t('no_questions_read_only') : undefined}
        showReportButton={basePath.startsWith('/app')}
        t={t}
      />

      <CreateFromQuestionDialog
        question={flashcardSourceQuestion}
        open={!!flashcardSourceQuestion}
        onOpenChange={(open) => {
          if (!open) setFlashcardSourceQuestion(null);
        }}
      />

      <QuestionFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingQuestion(null);
        }}
        initialValues={editingQuestion}
        bankId={bankId}
        topics={topics}
        onSubmit={handleSubmit}
        t={tForm}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_title')}
        description={t('delete_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />
    </div>
  );
}
