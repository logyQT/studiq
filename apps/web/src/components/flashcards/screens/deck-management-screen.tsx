'use client';

import type { Deck } from '@studiq/server/models/flashcard-deck.model';
import { Button } from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Download,
  EyeOff,
  FileUp,
  FolderOpen,
  Plus,
  SquarePen,
  Trash2,
  Upload,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { DeckCard } from '@/components/flashcards/cards/deck-card';
import {
  CollectionScreen,
  contentFormDialogLabels,
  contentFormDialogProps,
  useCollectionScreen,
} from '@/components/shared/collection-screen';
import { FirstVisitHint } from '@/components/shared/first-visit-hint';
import { CollectionCardSkeleton } from '@/components/shared/page-grid';
import { useApiMutation } from '@/hooks/use-api';
import { useContentFormError } from '@/hooks/use-content-form-error';
import { usePermission } from '@/hooks/use-permission';
import { apiPost, apiPut, isNetworkError } from '@/lib/api';
import { saveFailureMessage } from '@/lib/error-messages';
import { flashcardKeys } from '@/lib/query-keys';
import type { ContentFormValues } from '@/lib/share-fields';

const ImportDialog = dynamic(
  () =>
    import('@/components/flashcards/shared/import-dialog').then((m) => ({
      default: m.ImportDialog,
    })),
  { ssr: false },
);
const DeckFormDialog = dynamic(() =>
  import('@/components/flashcards/shared/deck-form-dialog').then((m) => ({
    default: m.DeckFormDialog,
  })),
);

interface DeckManagementScreenProps {
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

export function DeckManagementScreen({ basePath, t }: DeckManagementScreenProps) {
  const permission = usePermission();
  const tErr = useTranslations('Errors');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Students get the suspend filter inside the filter list; teachers keep the
  // toolbar toggle, because suspending is their action rather than a view option.
  // `app_metadata` is an untyped Supabase map; `account_type` must be narrowed.
  const rawAccountType: unknown = user?.app_metadata.account_type;
  const isStudent = rawAccountType === 'student';
  const [includeSuspended, setIncludeSuspended] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const screen = useCollectionScreen<Deck>({
    url: '/api/v1/flashcards/decks',
    persistKey: 'flashcard_decks_filters',
    legacyMine: { key: 'flashcard_decks_group_filter' },
    queryKey: (filters, orgId) => flashcardKeys.decks.paginated(filters, orgId),
    invalidateKeys: [flashcardKeys.decks.all],
    extraFilters: { includeSuspended: includeSuspended ? 'true' : undefined },
    // The student's „Zawieszone” row is a filter like any other, so an empty list
    // under it is a no-results state, not an empty collection.
    extraActiveFilters: includeSuspended ? 1 : 0,
  });
  const { create, update, batchDelete, selection } = screen;
  const [formError, setFormError] = useContentFormError(screen.dialogOpen);

  const batchToggleSuspend = useApiMutation({
    mutationFn: (data: { deckIds: string[]; suspended: boolean }) =>
      apiPost('/api/v1/flashcards/decks/batch/suspend', data),
    invalidateKeys: [...flashcardKeys.afterDeckSuspend],
  });

  async function handleSubmit(data: ContentFormValues) {
    if (!data.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    setFormError(null);
    // The dialog drops an unchanged share set (#1555): sending `groupIds` again would run the
    // group-teacher check and fail an org Admin's name edit.
    const body = { ...data, description: data.description || undefined };
    try {
      if (screen.editing) {
        await update.mutateAsync({ id: screen.editing.id, ...body });
        await queryClient.refetchQueries({ queryKey: flashcardKeys.decks.all });
      } else {
        await create.mutateAsync(body);
      }
      screen.closeDialog();
      toast.success(screen.editing ? t('deck_updated') : t('deck_created'));
    } catch (error) {
      setFormError(
        isNetworkError(error)
          ? t('save_failed_offline')
          : saveFailureMessage(error, t('save_failed'), tErr),
      );
    }
  }

  function handleBatchExportSelection() {
    const ids = Array.from(selection.selectedIds);
    if (ids.length === 0) return;
    window.open(`/api/v1/flashcards/export/csv?deckIds=${ids.join(',')}`, '_blank');
  }

  async function handleBatchDeleteSelection() {
    const ids = Array.from(selection.selectedIds);
    if (ids.length === 0) return;
    try {
      await batchDelete.mutateAsync(ids);
      toast.success(t('deck_deleted'));
      selection.handleClearSelection();
    } catch {
      toast.error(t('delete_failed'));
    }
  }

  async function handleBatchToggleSuspend(suspended: boolean) {
    const ids = Array.from(selection.selectedIds);
    if (ids.length === 0) return;
    try {
      await batchToggleSuspend.mutateAsync({ deckIds: ids, suspended });
      toast.success(suspended ? t('deck_suspended') : t('deck_unsuspended'));
      selection.handleClearSelection();
    } catch (error) {
      toast.error(isNetworkError(error) ? t('save_failed_offline') : t('save_failed'));
    }
  }

  async function handleToggleSuspend(deck: Deck) {
    try {
      await apiPut(`/api/v1/flashcards/decks/${deck.id}`, { suspended: !deck.suspended });
      for (const queryKey of flashcardKeys.afterDeckSuspend) {
        void queryClient.invalidateQueries({ queryKey });
      }
      toast.success(deck.suspended ? t('deck_unsuspended') : t('deck_suspended'));
    } catch (error) {
      toast.error(isNetworkError(error) ? t('save_failed_offline') : t('save_failed'));
    }
  }

  return (
    <CollectionScreen<Deck>
      t={t}
      screen={screen}
      actions={
        <>
          <Button variant="outline" className="justify-start" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4" /> {t('common_import')}
          </Button>
          <Button className="justify-start" onClick={screen.openCreate}>
            <Plus className="h-4 w-4" /> {t('new_deck')}
          </Button>
        </>
      }
      filterExtra={
        isStudent
          ? {
              label: t('show_suspended'),
              checked: includeSuspended,
              onToggle: () => setIncludeSuspended((previous) => !previous),
              onClear: () => setIncludeSuspended(false),
            }
          : undefined
      }
      toolbarExtra={
        isStudent ? undefined : (
          <Button
            variant={includeSuspended ? 'default' : 'outline'}
            size="sm"
            aria-label={t('show_suspended')}
            aria-pressed={includeSuspended}
            onClick={() => setIncludeSuspended(!includeSuspended)}
            className="gap-1.5"
          >
            <EyeOff className="h-4 w-4" />
            {includeSuspended && <span>{t('show_suspended')}</span>}
          </Button>
        )
      }
      countLabel={(total) => t('decks_count', { count: total })}
      hint={<FirstVisitHint id="decks" />}
      skeleton={<CollectionCardSkeleton />}
      skeletonCount={12}
      emptyIcon={<FolderOpen className="h-10 w-10 text-muted-foreground" />}
      emptyTitle={t('no_decks')}
      emptyAction={
        <Button variant="outline" size="sm" onClick={screen.openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('new_deck')}
        </Button>
      }
      noResultsSubject={t('no_results_subject')}
      deleteLabels={{ title: t('delete_dialog_title'), description: t('delete_dialog_desc') }}
      deletedMessage={t('deck_deleted')}
      bulkActions={
        <>
          <Button variant="outline" size="sm" onClick={() => handleBatchToggleSuspend(true)}>
            <EyeOff className="mr-1.5 h-4 w-4" /> {t('suspend_deck')}
          </Button>
          <Button variant="outline" size="sm" onClick={() => handleBatchToggleSuspend(false)}>
            <EyeOff className="mr-1.5 h-4 w-4" /> {t('unsuspend_deck')}
          </Button>
          <Button variant="outline" size="sm" onClick={handleBatchExportSelection}>
            <Download className="mr-1.5 h-4 w-4" /> {t('common_export')}
          </Button>
          <Button variant="destructive" size="sm" onClick={handleBatchDeleteSelection}>
            <Trash2 className="mr-1.5 h-4 w-4" /> {t('common_delete')}
          </Button>
        </>
      }
      speedDialItems={[
        { icon: SquarePen, label: t('new_deck'), onClick: screen.openCreate },
        { icon: Upload, label: t('common_import'), onClick: () => setImportOpen(true) },
        {
          icon: CheckSquare,
          label: t('select_cards'),
          onClick: () => selection.setIsSelecting(true),
        },
      ]}
      renderCard={(deck) => (
        <DeckCard
          deck={deck}
          isSelecting={selection.isSelecting}
          isSelected={selection.selectedIds.has(deck.id)}
          onToggleSelect={() => selection.toggleSelect(deck.id)}
          basePath={basePath}
          t={t}
          canUpdate={permission('deck.update', {
            createdBy: deck.created_by,
            orgId: deck.organization_id,
          })}
          canDelete={permission('deck.delete', {
            createdBy: deck.created_by,
            orgId: deck.organization_id,
          })}
          onEdit={() => screen.openEdit(deck)}
          onDelete={() => screen.setDeleteId(deck.id)}
          onExport={() => window.open(`/api/v1/flashcards/export/csv?deckIds=${deck.id}`, '_blank')}
          onSelect={() => selection.setIsSelecting(true)}
          onToggleSuspend={() => handleToggleSuspend(deck)}
          groupNames={deck.groupIds
            ?.map((id) => screen.groupNameMap.get(id))
            .filter((name): name is string => Boolean(name))}
        />
      )}
    >
      <DeckFormDialog
        {...contentFormDialogProps(screen, (deck) => ({
          visibility: deck.visibility,
          groupIds: deck.groupIds ?? [],
        }))}
        onSubmit={handleSubmit}
        title={screen.editing ? t('edit_title') : t('new_deck_title')}
        description={screen.editing ? t('edit_desc') : t('new_deck_desc')}
        submitLabel={screen.editing ? t('common_update') : t('common_create')}
        groups={screen.groupsData}
        error={formError ?? undefined}
        {...contentFormDialogLabels(t)}
      />

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} t={t} />
    </CollectionScreen>
  );
}
