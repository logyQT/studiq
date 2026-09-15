'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  CheckSquare,
  Download,
  EyeOff,
  FolderOpen,
  Plus,
  SquarePen,
  Trash2,
  Upload,
} from 'lucide-react';
import dynamic from 'next/dynamic';
import type { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DeckCard } from '@/components/flashcards/cards/deck-card';
import { DeckFilters } from '@/components/flashcards/shared/deck-filters';
import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { PageGrid } from '@/components/shared/page-grid';
import { SpeedDial } from '@/components/shared/speed-dial';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermission } from '@/hooks/use-permission';
import { apiDelete, apiPost, apiPut } from '@/lib/api';
import { flashcardKeys, groupKeys } from '@/lib/query-keys';
import type { Deck } from '@/server/models';

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

import { useCursorPagination } from '@/hooks/use-cursor-pagination';
import { useDebounce } from '@/hooks/use-debounce';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { useSelection } from '@/hooks/use-selection';

interface DeckManagementScreenProps {
  apiBase: string;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

export function DeckManagementScreen({ basePath, t }: DeckManagementScreenProps) {
  const { activeOrg } = useOrgs();
  const feature = useFeature();
  const permission = usePermission();

  const { data: groupsData } = useApiQuery<Array<{ id: string; name: string }>>({
    queryKey: groupKeys.list(activeOrg?.id),
    url: '/api/v1/organization/groups',
    enabled: !!activeOrg?.id && feature('group.manage'),
  });
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [owner, setOwner] = usePersistedState('flashcard_decks_owner', 'all');
  const [sortBy, setSortBy] = usePersistedState('flashcard_decks_sort_by', 'created_at');
  const [sortOrder, setSortOrder] = usePersistedState('flashcard_decks_sort_order', 'desc');
  const [includeSuspended, setIncludeSuspended] = useState(false);

  const {
    items: decks,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useCursorPagination<Deck>({
    queryKey: flashcardKeys.decks.paginated({
      q: debouncedSearch,
      owner,
      sortBy,
      sortOrder,
      includeSuspended: includeSuspended ? 'true' : undefined,
    }),
    url: '/api/v1/flashcards/decks',
    filters: {
      q: debouncedSearch || undefined,
      owner: owner !== 'all' ? owner : undefined,
      sortBy,
      sortOrder,
      includeSuspended: includeSuspended ? 'true' : undefined,
    },
    limit: 24,
    staleTime: Infinity,
  });

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  const createDeck = useApiMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      visibility?: string;
      groupIds?: string[];
    }) => apiPost<Deck>('/api/v1/flashcards/decks', data),
    invalidateKeys: [flashcardKeys.decks.all],
  });
  const updateDeck = useApiMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name: string;
      description?: string;
      visibility?: string;
      groupIds?: string[];
    }) => apiPut<Deck>(`/api/v1/flashcards/decks/${id}`, data),
  });
  const deleteDeck = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/decks/${id}`),
    invalidateKeys: [flashcardKeys.decks.all],
  });
  const batchDeleteDecks = useApiMutation({
    mutationFn: (data: { ids: string[] }) => apiPost('/api/v1/flashcards/decks/batch/delete', data),
    invalidateKeys: [flashcardKeys.decks.all],
  });

  const batchToggleSuspend = useApiMutation({
    mutationFn: (data: { deckIds: string[]; suspended: boolean }) =>
      apiPost('/api/v1/flashcards/decks/batch/suspend', data),
    invalidateKeys: [flashcardKeys.decks.all],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deck | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const selection = useSelection();
  const { isSelecting: selectionIsActive, handleClearSelection: selectionClear } = selection;
  const canCreateDeck = true;

  useEffect(() => {
    if (!selectionIsActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        selectionClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectionIsActive, selectionClear]);

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(deck: Deck) {
    setEditing(deck);
    setDialogOpen(true);
  }

  async function handleSubmit(data: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }) {
    if (!data.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    try {
      if (editing) {
        await updateDeck.mutateAsync({
          id: editing.id,
          name: data.name,
          description: data.description || undefined,
          visibility: data.visibility,
          groupIds: data.visibility === 'group' ? data.groupIds : [],
        });
        await queryClient.refetchQueries({ queryKey: flashcardKeys.decks.all });
      } else {
        await createDeck.mutateAsync({
          name: data.name,
          description: data.description || undefined,
          visibility: data.visibility,
          groupIds: data.visibility === 'group' ? data.groupIds : [],
        });
      }
      setDialogOpen(false);
      setEditing(null);
      toast.success(editing ? t('deck_updated') : t('deck_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  function handleToggleSelect(id: string) {
    selection.toggleSelect(id);
  }

  function handleClearSelection() {
    selection.handleClearSelection();
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
      await batchDeleteDecks.mutateAsync({ ids });
      toast.success(t('deck_deleted'));
      handleClearSelection();
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
      handleClearSelection();
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleToggleSuspend(deck: Deck) {
    try {
      await apiPut(`/api/v1/flashcards/decks/${deck.id}`, { suspended: !deck.suspended });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
      toast.success(deck.suspended ? t('deck_unsuspended') : t('deck_suspended'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteDeck.mutateAsync(deleteId);
      toast.success(t('deck_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  return (
    <div className="space-y-6">
      <DeckFilters
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        owner={owner}
        onOwnerChange={(v) => {
          setOwner(v);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(sb, so) => {
          setSortBy(sb);
          setSortOrder(so);
        }}
        includeSuspended={includeSuspended}
        onIncludeSuspendedChange={setIncludeSuspended}
        onImport={() => setImportOpen(true)}
        onCreateNew={openCreate}
        t={t}
      />

      <PageGrid
        cols={4}
        isLoading={isLoading}
        skeleton={
          <Card className="flex flex-col h-full max-sm:py-0 min-w-0 p-0">
            <div className="flex items-center gap-3 p-4 sm:hidden">
              <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            </div>
            <div className="hidden sm:flex flex-col h-full p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <Skeleton className="h-6 w-3/4" />
              </div>
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
              <div className="flex items-center justify-between pt-4 mt-auto">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </Card>
        }
        skeletonCount={12}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        isEmpty={decks.length === 0}
        emptyIcon={<FolderOpen className="h-10 w-10 text-muted-foreground" />}
        emptyTitle={t('no_decks')}
        emptyAction={
          canCreateDeck && (
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('new_deck')}
            </Button>
          )
        }
      >
        {decks.map((deck) => (
          <DeckCard
            key={deck.id}
            deck={deck}
            isSelecting={selection.isSelecting}
            isSelected={selection.selectedIds.has(deck.id)}
            onToggleSelect={() => handleToggleSelect(deck.id)}
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
            onEdit={() => openEdit(deck)}
            onDelete={() => setDeleteId(deck.id)}
            onExport={() =>
              window.open(`/api/v1/flashcards/export/csv?deckIds=${deck.id}`, '_blank')
            }
            onSelect={() => selection.setIsSelecting(true)}
            onToggleSuspend={() => handleToggleSuspend(deck)}
          />
        ))}
      </PageGrid>

      <DeckFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setTimeout(() => setEditing(null), 200);
        }}
        initialValues={
          editing
            ? {
                name: editing.name,
                description: editing.description ?? '',
                visibility: editing.visibility,
                groupIds: editing.groupIds ?? [],
              }
            : null
        }
        onSubmit={handleSubmit}
        title={editing ? t('edit_title') : t('new_deck_title')}
        description={editing ? t('edit_desc') : t('new_deck_desc')}
        nameLabel={t('name_label')}
        namePlaceholder={t('name_placeholder')}
        descriptionLabel={t('description_label')}
        descriptionPlaceholder={t('description_placeholder')}
        cancelLabel={t('common_cancel')}
        submitLabel={editing ? t('common_update') : t('common_create')}
        groups={groupsData}
        visibilityLabel={t('visibility_label')}
        visibilityPersonalLabel={t('visibility_personal')}
        visibilityGroupLabel={t('visibility_group')}
        groupsPlaceholder={t('groups_placeholder')}
        groupsEmptyText={t('groups_empty')}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <BulkActionBar
        selectedCount={selection.selectedIds.size}
        onClearSelection={handleClearSelection}
      >
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
      </BulkActionBar>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} t={t} />

      {!selection.isSelecting && (
        <div className="sm:hidden">
          <SpeedDial
            items={[
              ...(canCreateDeck
                ? [
                    {
                      icon: SquarePen,
                      label: t('new_deck'),
                      onClick: openCreate,
                    },
                  ]
                : []),
              { icon: Upload, label: t('common_import'), onClick: () => setImportOpen(true) },
              {
                icon: CheckSquare,
                label: t('select_cards'),
                onClick: () => selection.setIsSelecting(true),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
