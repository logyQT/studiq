'use client';

import type { QueryKey } from '@tanstack/react-query';
import type { useTranslations } from 'next-intl';
import { Fragment, type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@studiq/ui';
import { Trash2 } from 'lucide-react';
import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { ContentListToolbar } from '@/components/shared/content-list-toolbar';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { PageGrid } from '@/components/shared/page-grid';
import { SelectAllRow } from '@/components/shared/select-all-row';
import { SpeedDial, type SpeedDialItem } from '@/components/shared/speed-dial';
import { isRecord, readString } from '@studiq/server/lib/record';
import { useApiMutation } from '@/hooks/use-api';
import { useCursorPagination } from '@/hooks/use-cursor-pagination';
import { useGroupOptions, type GroupOption } from '@/hooks/use-group-options';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useOrgs } from '@/hooks/use-orgs';
import { usePersistedState } from '@/hooks/use-persisted-state';
import { useSelection } from '@/hooks/use-selection';
import { apiDelete, apiPost, apiPut } from '@/lib/api';
import { contentSortOptions, type SortOption } from '@/lib/content-sort-options';
import { type ListEmptyView, resolveListEmptyView } from '@/lib/list-empty-view';

/**
 * The filters every content collection shares: search, scope, groups, sort, plus
 * any collection-specific params. The index signature lets it stand in for the
 * `Record<string, string | undefined>` the query-key builders take.
 */
export type CollectionFilters = Record<string, string | undefined> & {
  /** Debounced search text. */
  q: string;
  owner: string;
  groups: string | undefined;
  sortBy: string;
  sortOrder: string;
};

interface PersistedFilters {
  owner: string;
  groupIds: string[];
  sortBy: string;
  sortOrder: string;
}

const DEFAULT_FILTERS: PersistedFilters = {
  owner: 'all',
  groupIds: [],
  sortBy: 'created_at',
  sortOrder: 'desc',
};

/** One-shot migration from the retired `all|mine` group toggle (#595). */
interface LegacyMine {
  /** localStorage entry holding the retired flag: a JSON `"mine"` or a blob field. */
  key: string;
  /** Read the flag from this field of the blob at `key` instead of the value itself. */
  field?: string;
}

interface CollectionScreenOptions {
  /** Collection root on the API, e.g. `/api/v1/flashcards/decks`. */
  url: string;
  /** Key for the paginated list, built from the active filters. */
  queryKey: (filters: CollectionFilters, orgId: string | undefined) => QueryKey;
  /** Keys invalidated after a write. */
  invalidateKeys: QueryKey[];
  /** localStorage namespace for the filters, so a reload keeps them. */
  persistKey: string;
  /** Extra request params that are not part of the shared filter set. */
  extraFilters?: Record<string, string | undefined>;
  limit?: number;
  legacyMine?: LegacyMine;
}

/** Everything a collection screen's frame needs; `useCollectionScreen` owns it. */
export interface CollectionScreenState<T extends { id: string }> {
  searchInput: string;
  setSearchInput: (value: string) => void;
  debouncedSearch: string;
  owner: string;
  setOwner: (value: string) => void;
  groupIds: string[];
  setGroupIds: (ids: string[]) => void;
  effectiveGroupIds: string[];
  sortBy: string;
  sortOrder: string;
  setSort: (sortBy: string, sortOrder: string) => void;
  clearFilters: () => void;
  groupOptions: GroupOption[];
  myGroupIds: string[];
  groupNameMap: Map<string, string>;
  /** Raw group list for the create/edit dialogs. */
  groupsData: GroupOption[] | undefined;
  items: T[];
  total: number | undefined;
  isLoading: boolean;
  isError: boolean;
  orgsPending: boolean;
  refetch: () => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  loadMoreRef: ReturnType<typeof useInfiniteScroll>;
  emptyView: ListEmptyView;
  selection: ReturnType<typeof useSelection<string>>;
  dialogOpen: boolean;
  setDialogOpen: (open: boolean) => void;
  editing: T | null;
  openCreate: () => void;
  openEdit: (item: T) => void;
  closeDialog: () => void;
  deleteId: string | null;
  setDeleteId: (id: string | null) => void;
  create: ReturnType<typeof useApiMutation<unknown, unknown>>;
  update: ReturnType<typeof useApiMutation<unknown, { id: string } & Record<string, unknown>>>;
  remove: ReturnType<typeof useApiMutation<unknown, string>>;
  batchDelete: ReturnType<typeof useApiMutation<unknown, string[]>>;
}

/**
 * State machine behind every content collection screen (decks, topics, question
 * banks, and any future one): persisted filters, group scoping, cursor
 * pagination, selection, the create/edit/delete dialogs and the four write
 * mutations. Screens keep their copy, cards and extra actions; this keeps the
 * behaviour from drifting apart again.
 */
export function useCollectionScreen<T extends { id: string }>({
  url,
  queryKey,
  invalidateKeys,
  persistKey,
  extraFilters,
  limit = 24,
  legacyMine,
}: CollectionScreenOptions): CollectionScreenState<T> {
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const {
    groupsData,
    options: groupOptions,
    myGroupIds,
    groupNameMap,
    ready: groupsReady,
  } = useGroupOptions();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const [persisted, setPersisted] = usePersistedState<PersistedFilters>(
    persistKey,
    DEFAULT_FILTERS,
  );
  // A legacy persisted `mine` is the only owner value the API still understands.
  const owner = persisted.owner === 'mine' ? 'mine' : 'all';
  const groupIds = persisted.groupIds;

  const setOwner = useCallback(
    (value: string) => {
      setPersisted((prev) => ({ ...prev, owner: value === 'mine' ? 'mine' : 'all' }));
    },
    [setPersisted],
  );
  const setGroupIds = useCallback(
    (ids: string[]) => {
      setPersisted((prev) => ({ ...prev, groupIds: ids }));
    },
    [setPersisted],
  );
  const setSort = useCallback(
    (sortBy: string, sortOrder: string) => {
      setPersisted((prev) => ({ ...prev, sortBy, sortOrder }));
    },
    [setPersisted],
  );

  const optionIds = new Set(groupOptions.map((group) => group.id));
  // Org switch / lost membership must never leave stale ids in the request.
  const effectiveGroupIds = groupIds.filter((id) => optionIds.has(id));
  const groupsParam = effectiveGroupIds.join(',') || undefined;

  const migrated = useRef(false);
  useEffect(() => {
    if (!legacyMine || !groupsReady || migrated.current) return;
    migrated.current = true;
    const raw = localStorage.getItem(legacyMine.key);
    if (raw === null) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      // A malformed legacy entry carries no preference: leave the filters alone.
      return;
    }
    const saysMine = legacyMine.field
      ? isRecord(parsed) && readString(parsed, legacyMine.field) === 'mine'
      : parsed === 'mine';
    if (saysMine) setGroupIds(groupIds.length > 0 ? groupIds : myGroupIds);
  }, [legacyMine, groupsReady, groupIds, myGroupIds, setGroupIds]);

  const filters: CollectionFilters = {
    q: debouncedSearch,
    owner,
    groups: groupsParam,
    sortBy: persisted.sortBy,
    sortOrder: persisted.sortOrder,
    ...extraFilters,
  };

  const pagination = useCursorPagination<T>({
    queryKey: queryKey(filters, activeOrg?.id),
    url,
    filters: {
      q: debouncedSearch || undefined,
      owner: owner !== 'all' ? owner : undefined,
      groups: groupsParam,
      sortBy: persisted.sortBy,
      sortOrder: persisted.sortOrder,
      ...extraFilters,
    },
    limit,
    staleTime: Infinity,
    // Hold the first paint while a persisted selection waits for its options, so
    // the list never briefly shows unfiltered rows.
    enabled: !orgsPending && !(groupIds.length > 0 && !groupsReady),
  });

  const loadMoreRef = useInfiniteScroll({
    hasNextPage: pagination.hasNextPage,
    isFetchingNextPage: pagination.isFetchingNextPage,
    fetchNextPage: pagination.fetchNextPage,
  });

  const selection = useSelection<string>();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<T | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const create = useApiMutation<unknown, unknown>({
    mutationFn: (body) => apiPost<unknown>(url, body),
    invalidateKeys,
  });
  const update = useApiMutation<unknown, { id: string } & Record<string, unknown>>({
    mutationFn: ({ id, ...body }) => apiPut<unknown>(`${url}/${id}`, body),
    invalidateKeys,
  });
  const remove = useApiMutation<unknown, string>({
    mutationFn: (id) => apiDelete(`${url}/${id}`),
    invalidateKeys,
  });
  const batchDelete = useApiMutation<unknown, string[]>({
    mutationFn: (ids) => apiPost<unknown>(`${url}/batch/delete`, { ids }),
    invalidateKeys,
  });

  const openCreate = () => {
    setEditing(null);
    setDialogOpen(true);
  };
  const openEdit = (item: T) => {
    setEditing(item);
    setDialogOpen(true);
  };
  // The dialog animates out; clear the edited row only once it has closed.
  const closeDialog = () => {
    setDialogOpen(false);
    setTimeout(() => setEditing(null), 200);
  };

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedSearch('');
    setOwner('all');
    setGroupIds([]);
  };

  return {
    searchInput,
    setSearchInput,
    debouncedSearch,
    owner,
    setOwner,
    groupIds,
    setGroupIds,
    effectiveGroupIds,
    sortBy: persisted.sortBy,
    sortOrder: persisted.sortOrder,
    setSort,
    clearFilters,
    groupOptions,
    myGroupIds,
    groupNameMap,
    groupsData,
    items: pagination.items,
    total: pagination.total,
    isLoading: pagination.isLoading,
    isError: pagination.isError,
    orgsPending,
    refetch: pagination.refetch,
    hasNextPage: pagination.hasNextPage,
    isFetchingNextPage: pagination.isFetchingNextPage,
    loadMoreRef,
    emptyView: resolveListEmptyView({
      visibleCount: pagination.items.length,
      query: debouncedSearch,
      activeFilters: (owner !== 'all' ? 1 : 0) + effectiveGroupIds.length,
    }),
    selection,
    dialogOpen,
    setDialogOpen,
    editing,
    openCreate,
    openEdit,
    closeDialog,
    deleteId,
    setDeleteId,
    create,
    update,
    remove,
    batchDelete,
  };
}

/**
 * Open/close wiring and starting values for a content form dialog: the frame's
 * dialog state mapped onto the props the `*FormDialog` components take. `extra`
 * adds the fields a specific collection's dialog edits.
 */
export function contentFormDialogProps<
  T extends { id: string; name: string; description?: string | null },
>(
  screen: {
    dialogOpen: boolean;
    setDialogOpen: (open: boolean) => void;
    closeDialog: () => void;
    editing: T | null;
  },
  extra?: (editing: T) => Record<string, unknown>,
) {
  return {
    open: screen.dialogOpen,
    onOpenChange: (open: boolean) => {
      if (open) screen.setDialogOpen(true);
      else screen.closeDialog();
    },
    initialValues: screen.editing
      ? {
          name: screen.editing.name,
          description: screen.editing.description ?? '',
          ...extra?.(screen.editing),
        }
      : null,
  };
}

/**
 * The copy every content form dialog shares: name, description, visibility and
 * the group picker. A dialog that adds a field spreads this and passes the rest.
 */
export function contentFormDialogLabels(t: ReturnType<typeof useTranslations>) {
  return {
    nameLabel: t('name_label'),
    namePlaceholder: t('name_placeholder'),
    descriptionLabel: t('description_label'),
    descriptionPlaceholder: t('description_placeholder'),
    cancelLabel: t('common_cancel'),
    visibilityLabel: t('visibility_label'),
    visibilityPersonalLabel: t('visibility_personal'),
    visibilityGroupLabel: t('visibility_group'),
    groupsPlaceholder: t('groups_placeholder'),
    groupsEmptyText: t('groups_empty'),
  };
}

interface CollectionScreenProps<T extends { id: string }> {
  t: ReturnType<typeof useTranslations>;
  screen: CollectionScreenState<T>;
  /** Toolbar buttons, e.g. create and import. */
  actions?: ReactNode;
  /** List-specific toolbar control after the sort select, e.g. the deck suspend toggle. */
  toolbarExtra?: ReactNode;
  /** Placeholder copy for the search input; defaults to `search_placeholder`. */
  searchPlaceholder?: string;
  /** Sort orders the collection supports; defaults to the shared content set. */
  sortOptions?: SortOption[];
  /** Total line above the grid; omit for collections that do not show one. */
  countLabel?: (total: number) => string;
  hint?: ReactNode;
  skeleton: ReactNode;
  skeletonCount?: number;
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptyAction?: ReactNode;
  /** Plural noun for the collection, e.g. "talii" / "decks". */
  noResultsSubject: string;
  renderCard: (item: T) => ReactNode;
  /** Copy for the delete confirmation, whose dialog the frame renders. */
  deleteLabels: { title: string; description: string };
  /** Toast after a successful delete. */
  deletedMessage: string;
  /** Copy for a failed delete; the question bank names its CONFLICT case. */
  deleteError?: (error: unknown) => string;
  /**
   * Replaces the default "delete selected" bulk action. Collections with extra
   * bulk operations (the deck suspend/export bar) supply their own.
   */
  bulkActions?: ReactNode;
  /** Mobile speed-dial entries, shown while not selecting. */
  speedDialItems?: SpeedDialItem[];
  /** The screen's own dialogs (form, view, import). */
  children?: ReactNode;
}

/** Frame around a collection list: toolbar, count, grid, and the screen's own dialogs. */
export function CollectionScreen<T extends { id: string }>({
  t,
  screen,
  actions,
  toolbarExtra,
  searchPlaceholder,
  sortOptions,
  countLabel,
  hint,
  skeleton,
  skeletonCount,
  emptyIcon,
  emptyTitle,
  emptyAction,
  noResultsSubject,
  renderCard,
  deleteLabels,
  deletedMessage,
  deleteError,
  bulkActions,
  speedDialItems,
  children,
}: CollectionScreenProps<T>) {
  const { remove, batchDelete, selection } = screen;
  const failedDelete = deleteError ?? (() => t('delete_failed'));

  async function deleteOne(id: string) {
    try {
      await remove.mutateAsync(id);
      toast.success(deletedMessage);
    } catch (error) {
      toast.error(failedDelete(error));
    }
    screen.setDeleteId(null);
  }

  async function deleteSelected() {
    const ids = Array.from(selection.selectedIds);
    if (ids.length === 0) return;
    try {
      await batchDelete.mutateAsync(ids);
      toast.success(deletedMessage);
      selection.handleClearSelection();
    } catch (error) {
      toast.error(failedDelete(error));
    }
  }

  return (
    <div className="space-y-6">
      {selection.isSelecting && screen.items.length > 0 && (
        <SelectAllRow
          t={t}
          selectedCount={selection.selectedIds.size}
          total={screen.items.length}
          onSelectAll={() => selection.handleSelectAll(screen.items.map((item) => item.id))}
          onDeselectAll={selection.handleDeselectAll}
        />
      )}

      <ContentListToolbar
        searchInput={screen.searchInput}
        onSearchChange={screen.setSearchInput}
        searchPlaceholder={searchPlaceholder}
        owner={screen.owner}
        onOwnerChange={screen.setOwner}
        groupIds={screen.effectiveGroupIds}
        onGroupIdsChange={screen.setGroupIds}
        groupOptions={screen.groupOptions}
        myGroupIds={screen.myGroupIds}
        sortBy={screen.sortBy}
        sortOrder={screen.sortOrder}
        onSortChange={screen.setSort}
        sortOptions={sortOptions ?? contentSortOptions(t)}
        actions={actions}
        t={t}
      >
        {toolbarExtra}
      </ContentListToolbar>

      {countLabel && !screen.isLoading && !screen.orgsPending && screen.total !== undefined && (
        <p className="text-sm text-muted-foreground">{countLabel(screen.total)}</p>
      )}

      {hint}

      <PageGrid
        cols={4}
        isLoading={screen.isLoading || screen.orgsPending}
        skeleton={skeleton}
        skeletonCount={skeletonCount}
        hasNextPage={screen.hasNextPage}
        isFetchingNextPage={screen.isFetchingNextPage}
        loadMoreRef={screen.loadMoreRef}
        isEmpty={screen.items.length === 0}
        isError={screen.isError}
        onRetry={() => screen.refetch()}
        emptyView={screen.emptyView}
        onClearFilters={screen.clearFilters}
        noResultsSubject={noResultsSubject}
        emptyIcon={emptyIcon}
        emptyTitle={emptyTitle}
        emptyAction={emptyAction}
      >
        {screen.items.map((item) => (
          <Fragment key={item.id}>{renderCard(item)}</Fragment>
        ))}
      </PageGrid>

      {children}

      <DeleteConfirmDialog
        open={!!screen.deleteId}
        onOpenChange={() => screen.setDeleteId(null)}
        onConfirm={() => {
          if (screen.deleteId) void deleteOne(screen.deleteId);
        }}
        title={deleteLabels.title}
        description={deleteLabels.description}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <BulkActionBar
        selectedCount={selection.selectedIds.size}
        onClearSelection={selection.handleClearSelection}
      >
        {bulkActions ?? (
          <Button variant="destructive" size="sm" onClick={deleteSelected}>
            <Trash2 className="mr-1.5 h-4 w-4" /> {t('common_delete')}
          </Button>
        )}
      </BulkActionBar>

      {speedDialItems && !screen.selection.isSelecting && (
        <div className="sm:hidden">
          <SpeedDial items={speedDialItems} />
        </div>
      )}
    </div>
  );
}
