'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Plus } from 'lucide-react';
import Link from 'next/link';
import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { QuestionFormDialog } from '@/components/questions/shared/question-form-dialog';
import { QuestionTable } from '@/components/questions/shared/question-table';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { Button } from '@/components/ui/button';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { questionKeys } from '@/lib/query-keys';
import type { Question, QuestionBank } from '@/server/models';

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
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingQuestion, setEditingQuestion] = useState<Question | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const { data: bank } = useQuery({
    queryKey: questionKeys.banks.detail(bankId),
    queryFn: () => apiGet<QuestionBank>(`/api/v1/questions/banks/${bankId}`),
    staleTime: Infinity,
  });

  const { data: questions = [], isLoading: questionsLoading } = useQuery({
    queryKey: questionKeys.list({ bankId }),
    queryFn: () => apiGet<Question[]>(`/api/v1/questions?bankId=${bankId}`),
    staleTime: Infinity,
  });

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
  }) {
    if (editingQuestion) {
      await apiPut(`/api/v1/questions/${editingQuestion.id}`, data);
      toast.success(tForm('updated'));
    } else {
      await apiPost('/api/v1/questions', data);
      toast.success(tForm('created'));
    }
    invalidate();
    setDialogOpen(false);
    setEditingQuestion(null);
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await apiDelete(`/api/v1/questions/${deleteId}`);
      toast.success(tForm('updated'));
      invalidate();
    } catch {
      toast.error(tForm('save_failed'));
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
          </Link>
        </Button>
        <div className="flex-1">
          <h2 className="text-2xl font-bold">{bank?.name ?? t('title')}</h2>
          {bank?.description && (
            <p className="text-sm text-muted-foreground mt-1">{bank.description}</p>
          )}
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('create_question')}
        </Button>
      </div>

      <QuestionTable
        questions={questions}
        isLoading={questionsLoading}
        search={search}
        onSearchChange={setSearch}
        typeFilter={typeFilter}
        onTypeFilterChange={setTypeFilter}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(sb, so) => {
          setSortBy(sb);
          setSortOrder(so);
        }}
        onEdit={openEdit}
        onDelete={setDeleteId}
        showReportButton={basePath.startsWith('/app')}
        t={t}
      />

      <QuestionFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingQuestion(null);
        }}
        initialValues={editingQuestion}
        bankId={bankId}
        onSubmit={handleSubmit}
        t={tForm}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('common_delete')}
        description={t('common_confirm')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />
    </div>
  );
}
