'use client';

import type { QuestionBank } from '@studiq/server/models/question-bank.model';
import { Button } from '@studiq/ui';
import { CheckSquare, Database, Plus, SearchX, SquarePen } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { QuestionBankCard } from '@/components/questions/cards/question-bank-card';
import { QuestionBankFormDialog } from '@/components/questions/shared/question-bank-form-dialog';
import {
  CollectionScreen,
  contentFormDialogLabels,
  contentFormDialogProps,
  useCollectionScreen,
} from '@/components/shared/collection-screen';
import { FirstVisitHint } from '@/components/shared/first-visit-hint';
import { CollectionCardSkeleton } from '@/components/shared/page-grid';
import { usePermission } from '@/hooks/use-permission';
import { ApiError } from '@/lib/api';
import { questionKeys } from '@/lib/query-keys';

interface QuestionBankManagementScreenProps {
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

interface QuestionBankFormValues {
  name: string;
  description: string;
  visibility?: 'personal' | 'group';
  groupIds?: string[];
}

export function QuestionBankManagementScreen({ basePath, t }: QuestionBankManagementScreenProps) {
  const permission = usePermission();

  const screen = useCollectionScreen<QuestionBank>({
    url: '/api/v1/questions/banks',
    persistKey: 'question_banks_filters',
    // The retired `groupFilter` toggle lived inside this same blob (#595).
    legacyMine: { key: 'question_banks_filters', field: 'groupFilter' },
    queryKey: (filters, orgId) => questionKeys.banks.paginated(filters, orgId),
    invalidateKeys: [questionKeys.banks.all],
  });
  const { create, update, selection } = screen;

  /** #360 — a bank that still holds questions cannot be deleted. */
  const deleteFailureMessage = (error: unknown) =>
    error instanceof ApiError && error.code === 'CONFLICT'
      ? t('bank_delete_blocked')
      : t('common_error');

  async function handleSubmit(data: QuestionBankFormValues) {
    if (!data.name.trim()) {
      toast.error(t('common_error'));
      return;
    }
    const body = {
      name: data.name,
      description: data.description || undefined,
      visibility: data.visibility,
      groupIds: data.visibility === 'group' ? data.groupIds : undefined,
    };
    try {
      if (screen.editing) {
        await update.mutateAsync({ id: screen.editing.id, ...body });
        toast.success(t('bank_updated'));
      } else {
        await create.mutateAsync(body);
        toast.success(t('bank_created'));
      }
      screen.closeDialog();
    } catch {
      toast.error(t('common_error'));
    }
  }

  // A filtered-empty grid names the filter and offers the reset, not "create your first bank".
  const noResults = screen.emptyView.kind === 'no-results';

  return (
    <CollectionScreen<QuestionBank>
      t={t}
      screen={screen}
      actions={
        <Button className="justify-start" onClick={screen.openCreate}>
          <Plus className="h-4 w-4" /> {t('new_bank')}
        </Button>
      }
      hint={<FirstVisitHint id="question_banks" />}
      skeleton={<CollectionCardSkeleton />}
      skeletonCount={12}
      emptyIcon={
        noResults ? (
          <SearchX className="h-10 w-10 text-muted-foreground" />
        ) : (
          <Database className="h-10 w-10 text-muted-foreground" />
        )
      }
      emptyTitle={
        noResults
          ? screen.emptyView.kind === 'no-results' && screen.emptyView.query
            ? t('no_banks_match', { query: screen.emptyView.query })
            : t('no_banks_match_filters')
          : t('no_banks')
      }
      emptyAction={
        noResults ? (
          <Button variant="outline" size="sm" onClick={screen.clearFilters}>
            {t('clear_filters')}
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={screen.openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('new_bank')}
          </Button>
        )
      }
      deleteLabels={{ title: t('delete_title'), description: t('delete_desc') }}
      deletedMessage={t('bank_deleted')}
      deleteError={deleteFailureMessage}
      speedDialItems={[
        { icon: SquarePen, label: t('new_bank'), onClick: screen.openCreate },
        {
          icon: CheckSquare,
          label: t('select_banks'),
          onClick: () => selection.setIsSelecting(true),
        },
      ]}
      renderCard={(bank) => (
        <QuestionBankCard
          bank={bank}
          isSelecting={selection.isSelecting}
          isSelected={selection.selectedIds.has(bank.id)}
          onToggleSelect={() => selection.toggleSelect(bank.id)}
          basePath={basePath}
          t={t}
          canUpdate={permission('question_bank.update', {
            createdBy: bank.created_by,
            orgId: bank.organization_id ?? undefined,
          })}
          canDelete={permission('question_bank.delete', { createdBy: bank.created_by })}
          onEdit={() => screen.openEdit(bank)}
          onDelete={() => screen.setDeleteId(bank.id)}
          onSelect={() => selection.setIsSelecting(true)}
          groupNames={bank.groupIds
            ?.map((id) => screen.groupNameMap.get(id))
            .filter((name): name is string => Boolean(name))}
        />
      )}
    >
      <QuestionBankFormDialog
        {...contentFormDialogProps(screen)}
        onSubmit={handleSubmit}
        title={screen.editing ? t('edit_bank') : t('new_bank')}
        description={screen.editing ? t('common_edit') : t('common_create')}
        submitLabel={screen.editing ? t('common_update') : t('common_create')}
        groups={screen.groupsData}
        {...contentFormDialogLabels(t)}
      />
    </CollectionScreen>
  );
}
