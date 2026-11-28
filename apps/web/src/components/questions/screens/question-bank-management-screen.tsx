'use client';

import type { QuestionBank } from '@studiq/server/models/question-bank.model';
import { Button } from '@studiq/ui';
import { CheckSquare, Database, Plus, SquarePen } from 'lucide-react';
import { useTranslations } from 'next-intl';
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
import { useContentFormError } from '@/hooks/use-content-form-error';
import { usePermission } from '@/hooks/use-permission';
import { ApiError } from '@/lib/api';
import { saveFailureMessage } from '@/lib/error-messages';
import { questionKeys } from '@/lib/query-keys';
import { type ContentFormValues } from '@/lib/share-fields';

interface QuestionBankManagementScreenProps {
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

export function QuestionBankManagementScreen({ basePath, t }: QuestionBankManagementScreenProps) {
  const permission = usePermission();
  const tErr = useTranslations('Errors');

  const screen = useCollectionScreen<QuestionBank>({
    url: '/api/v1/questions/banks',
    persistKey: 'question_banks_filters',
    // The retired `groupFilter` toggle lived inside this same blob (#595).
    legacyMine: { key: 'question_banks_filters', field: 'groupFilter' },
    queryKey: (filters, orgId) => questionKeys.banks.paginated(filters, orgId),
    invalidateKeys: [questionKeys.banks.all],
  });
  const { create, update, selection } = screen;
  const [formError, setFormError] = useContentFormError(screen.dialogOpen);

  /** #360 — a bank that still holds questions cannot be deleted. */
  const deleteFailureMessage = (error: unknown) =>
    error instanceof ApiError && error.code === 'CONFLICT'
      ? t('bank_delete_blocked')
      : t('common_error');

  async function handleSubmit(data: ContentFormValues) {
    if (!data.name.trim()) {
      toast.error(t('common_error'));
      return;
    }
    setFormError(null);
    // The dialog omits an unchanged share set (#1557). An empty description stays omitted, so the
    // server keeps the stored one.
    const body = {
      ...data,
      description: data.description || undefined,
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
    } catch (error) {
      setFormError(saveFailureMessage(error, t('bank_save_failed'), tErr));
    }
  }

  return (
    <CollectionScreen<QuestionBank>
      t={t}
      screen={screen}
      actions={
        <Button className="justify-start" onClick={screen.openCreate}>
          <Plus className="h-4 w-4" /> {t('new_bank')}
        </Button>
      }
      countLabel={(total) => t('banks_count', { count: total })}
      hint={<FirstVisitHint id="question_banks" />}
      skeleton={<CollectionCardSkeleton />}
      skeletonCount={12}
      noResultsSubject={t('no_results_subject')}
      emptyIcon={<Database className="h-10 w-10 text-muted-foreground" />}
      emptyTitle={t('no_banks')}
      emptyAction={
        <Button variant="outline" size="sm" onClick={screen.openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('new_bank')}
        </Button>
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
          canDelete={permission('question_bank.delete', {
            createdBy: bank.created_by,
            orgId: bank.organization_id ?? undefined,
          })}
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
        {...contentFormDialogProps(screen, (bank) => ({
          visibility: bank.visibility,
          groupIds: bank.groupIds ?? [],
        }))}
        onSubmit={handleSubmit}
        title={screen.editing ? t('edit_bank') : t('new_bank')}
        description={screen.editing ? t('common_edit') : t('common_create')}
        submitLabel={screen.editing ? t('common_update') : t('common_create')}
        groups={screen.groupsData}
        error={formError ?? undefined}
        {...contentFormDialogLabels(t)}
      />
    </CollectionScreen>
  );
}
