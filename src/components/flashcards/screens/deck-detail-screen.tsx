'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Copy,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FileUp,
  Layers,
  Link2,
  Lock,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Sparkles,
  Tags,
  Trash2,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FlashcardCard } from '@/components/flashcards/cards/flashcard-card';
import { DeckDetailSkeleton } from '@/components/flashcards/shared/deck-detail-skeleton';
import { FlashcardToolbar } from '@/components/flashcards/shared/flashcard-toolbar';
import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import { PageGrid } from '@/components/shared/page-grid';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';

const DeckDetailDialogs = lazy(() =>
  import('@/components/flashcards/dialogs/deck-detail-dialogs').then((mod) => ({
    default: mod.DeckDetailDialogs,
  })),
);
type DialogsState = import('@/components/flashcards/dialogs/deck-detail-dialogs').DialogsState;
type DialogsHandlers =
  import('@/components/flashcards/dialogs/deck-detail-dialogs').DialogsHandlers;

import { ImportDialog } from '@/components/flashcards/shared/import-dialog';
import { useAuth } from '@/components/providers/AuthProvider';
import { ScrollBackToBar } from '@/components/shared/scroll-back-to-bar';
import { SpeedDial } from '@/components/shared/speed-dial';
import { useDebounce } from '@/hooks/use-debounce';
import { useFeature } from '@/hooks/use-feature';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelection } from '@/hooks/use-selection';
import { getGradientHex } from '@/lib/color-utils';
import { can } from '@/lib/frontend-rbac';
import type { UserRole } from '@/types';
import type { Deck, Flashcard, Topic } from '@/types/flashcards';

interface DeckDetailScreenProps {
  deckId: string;
  basePath: string;
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
  practiceHref?: string;
}

function getStorageKey(deckId: string) {
  return `flashcard_deck_detail_filters_${deckId}`;
}

function loadPersistedFilters(deckId: string) {
  if (typeof window === 'undefined')
    return { topicFilter: 'all', sortBy: 'created_at', sortOrder: 'desc' };
  try {
    const raw = localStorage.getItem(getStorageKey(deckId));
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { topicFilter: 'all', sortBy: 'created_at', sortOrder: 'desc' };
}

export function DeckDetailScreen({
  deckId,
  basePath,
  apiBase,
  t,
  practiceHref,
}: DeckDetailScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.app_metadata?.role as UserRole | undefined;
  const { activeOrg } = useOrgs();
  const headerGrad = getGradientHex(deckId);

  const persisted = loadPersistedFilters(deckId);

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [topicFilter, setTopicFilter] = useState(persisted.topicFilter);
  const [sortBy, setSortBy] = useState(persisted.sortBy);
  const [sortOrder, setSortOrder] = useState(persisted.sortOrder);

  useEffect(() => {
    try {
      localStorage.setItem(
        getStorageKey(deckId),
        JSON.stringify({ topicFilter, sortBy, sortOrder }),
      );
    } catch {
      /* ignore */
    }
  }, [deckId, topicFilter, sortBy, sortOrder]);

  const filters = {
    q: debouncedSearch || undefined,
    topicIds: topicFilter !== 'all' ? [topicFilter] : undefined,
    sortBy,
    sortOrder,
  };

  const params: Record<string, string> = {};
  params.deckIds = deckId;
  params.limit = '30';
  if (filters.q) params.q = filters.q;
  if (filters.sortBy) params.sortBy = filters.sortBy;
  if (filters.sortOrder) params.sortOrder = filters.sortOrder;
  if (filters.topicIds?.[0]) params.topicIds = filters.topicIds[0];
  const queryString = new URLSearchParams(params).toString();

  const {
    data: flashcardsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: [
      'flashcards',
      deckId,
      filters.q ?? '',
      filters.topicIds?.[0] ?? '',
      sortBy,
      sortOrder,
    ],
    queryFn: ({ pageParam }) =>
      apiGet<{ items: Flashcard[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/flashcards?${queryString}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    enabled: !!deckId,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const { data: topicsData } = useApiQuery<{
    items: Topic[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.topics.paginated({}),
    url: '/api/v1/flashcards/topics?limit=200',
  });
  const { data: currentDeck, isLoading: decksLoading } = useApiQuery<Deck>({
    queryKey: flashcardKeys.decks.detail(deckId),
    url: `/api/v1/flashcards/decks/${deckId}`,
    enabled: !!deckId,
  });

  const { data: allDecksData } = useApiQuery<{
    items: Deck[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks?limit=200',
  });

  const flashcards = flashcardsData?.pages.flatMap((page) => page.items) ?? [];
  const deckLoading = decksLoading;
  const deckError = !decksLoading && !currentDeck;
  const topics = topicsData?.items ?? [];
  const allDecks = (allDecksData?.items ?? []).filter((d) => d.id !== deckId);
  const flashcardQueryKey = flashcardKeys.list({ deckIds: [deckId] });

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

  const unlinkFlashcard = useApiMutation({
    mutationFn: (data: { id: string; deckId: string }) =>
      apiPost(`/api/v1/flashcards/${data.id}/unlink`, { deckId: data.deckId }),
    invalidateKeys: [flashcardQueryKey],
  });
  const updateDeck = useApiMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; description?: string }) =>
      apiPut<Deck>(`/api/v1/flashcards/decks/${id}`, data),
    invalidateKeys: [flashcardKeys.decks.all, flashcardKeys.decks.detail(deckId)],
    onMutate: async ({ id: _id, ...data }) => {
      const detailKey = flashcardKeys.decks.detail(deckId);
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all });
      await queryClient.cancelQueries({ queryKey: detailKey });
      const prev = queryClient.getQueryData<Deck>(detailKey);
      queryClient.setQueryData<Deck>(detailKey, (old) => (old ? { ...old, ...data } : old));
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(flashcardKeys.decks.detail(deckId), ctx?.previous);
    },
  });
  const toggleSuspendMutation = useApiMutation({
    mutationFn: (suspended: boolean) =>
      apiPut<Deck>(`/api/v1/flashcards/decks/${deckId}`, { suspended }),
    invalidateKeys: [flashcardKeys.decks.all, flashcardKeys.decks.detail(deckId)],
  });

  const deleteDeck = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/decks/${id}`),
    invalidateKeys: [flashcardKeys.decks.all, flashcardKeys.decks.detail(deckId)],
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all });
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.detail(id) });
      const prev = queryClient.getQueryData<Deck>(flashcardKeys.decks.detail(id));
      return { previous: prev };
    },
    onError: (_err, _id, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(flashcardKeys.decks.detail(_id), ctx.previous);
      }
    },
  });

  const batchUnlinkCards = useApiMutation({
    mutationFn: (data: { ids: string[]; deckId: string }) =>
      apiPost('/api/v1/flashcards/batch/unlink', { ids: data.ids, deckId: data.deckId }),
    invalidateKeys: [flashcardQueryKey, flashcardKeys.decks.all],
  });

  const batchLinkCards = useApiMutation({
    mutationFn: (data: { ids: string[]; deckIds: string[] }) =>
      apiPost('/api/v1/flashcards/batch/link', data),
    invalidateKeys: [flashcardKeys.decks.all],
  });

  const batchTopicCards = useApiMutation({
    mutationFn: (data: { ids: string[]; topicIds: string[]; operation: string }) =>
      apiPost('/api/v1/flashcards/batch/topics', data),
    invalidateKeys: [flashcardQueryKey],
  });

  const batchCopyCards = useApiMutation({
    mutationFn: (data: { ids: string[]; targetDeckId: string }) =>
      apiPost('/api/v1/flashcards/batch/copy', data),
    invalidateKeys: [flashcardQueryKey, flashcardKeys.decks.all],
  });

  const batchMoveCards = useApiMutation({
    mutationFn: (data: { ids: string[]; sourceDeckId: string; targetDeckId: string }) =>
      apiPost('/api/v1/flashcards/batch/move', data),
    invalidateKeys: [flashcardQueryKey, flashcardKeys.decks.all],
  });

  const selection = useSelection();
  const canCreateFlashcard = useFeature('study.create');
  const canAIChat = useFeature('ai.chat');
  const [importOpen, setImportOpen] = useState(false);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [barStyle, setBarStyle] = useState<React.CSSProperties>({});

  const [d, setD] = useState<DialogsState>({
    deleteId: null,
    linkOpen: false,
    copyOpen: false,
    copyResult: null,
    activeFlashcardId: null,
    linkDeckIds: [],
    copyTargetDeckId: null,
    deckEditOpen: false,
    deckDeleteOpen: false,

    viewTopicId: null,
    addTopicOpen: false,
    manageTopicOpen: false,
    topicActionIds: [],
    selectedIds: [],
    bulkDeleteOpen: false,
    bulkLinkOpen: false,
    bulkLinkDeckIds: [],
    bulkMoveOpen: false,
    bulkMoveTargetDeckId: null,
    bulkCopyOpen: false,
    bulkCopyTargetDeckId: null,
    bulkTopicsOpen: false,
    bulkTopicsOperation: 'set',
    bulkTopicIds: [],
  });

  const handleCardDelete = useCallback((id: string) => {
    setD((prev) => ({ ...prev, deleteId: id }));
  }, []);

  const handleCardLink = useCallback((fc: Flashcard) => {
    setD((prev) => ({
      ...prev,
      activeFlashcardId: fc.id,
      linkDeckIds: [],
      linkOpen: true,
    }));
  }, []);

  const handleCardCopy = useCallback((fc: Flashcard) => {
    setD((prev) => ({
      ...prev,
      activeFlashcardId: fc.id,
      copyTargetDeckId: null,
      copyOpen: true,
    }));
  }, []);

  const handleCardAddTopic = useCallback((fc: Flashcard) => {
    setD((prev) => ({
      ...prev,
      activeFlashcardId: fc.id,
      topicActionIds: [],
      addTopicOpen: true,
    }));
  }, []);

  const handleCardManageTopics = useCallback((fc: Flashcard) => {
    setD((prev) => ({ ...prev, activeFlashcardId: fc.id, manageTopicOpen: true }));
  }, []);

  const handleCardViewByTopic = useCallback((_fc: Flashcard, topicId: string) => {
    setD((prev) => ({ ...prev, viewTopicId: topicId }));
  }, []);

  const openEdit = useCallback(
    (fc: Flashcard) => {
      router.push(`${basePath}/decks/${deckId}/${fc.id}`);
    },
    [router, basePath, deckId],
  );

  async function handleDelete() {
    if (!d.deleteId) return;
    try {
      await unlinkFlashcard.mutateAsync({ id: d.deleteId, deckId });
      toast.success(t('flashcard_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setD((prev) => ({ ...prev, deleteId: null }));
  }

  async function handleLink() {
    if (!d.activeFlashcardId || d.linkDeckIds.length === 0) return;
    try {
      const res = await fetch(`${apiBase}/${d.activeFlashcardId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckIds: d.linkDeckIds }),
      });
      if (!res.ok) throw new Error();
      setD((prev) => ({ ...prev, linkOpen: false, linkDeckIds: [] }));
      toast.success(t('flashcard_linked'));
    } catch {
      toast.error(t('link_failed'));
    }
  }

  async function handleCopy() {
    if (!d.activeFlashcardId || !d.copyTargetDeckId) return;
    try {
      const res = await fetch(`${apiBase}/${d.activeFlashcardId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDeckId: d.copyTargetDeckId }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setD((prev) => ({
        ...prev,
        copyOpen: false,
        copyResult: { id: body.data.id, deckId: d.copyTargetDeckId! },
      }));
      toast.success(t('flashcard_copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  }

  async function handleDeckUpdate(data: { name: string; description: string }) {
    if (!data.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    setD((prev) => ({ ...prev, deckEditOpen: false }));
    try {
      await updateDeck.mutateAsync({
        id: deckId,
        name: data.name,
        description: data.description || undefined,
      });
      toast.success(t('deck_updated'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDeckDelete() {
    try {
      await deleteDeck.mutateAsync(deckId);
      toast.success(t('deck_deleted'));
      router.push('/app/flashcards/decks');
    } catch {
      toast.error(t('delete_failed'));
    }
    setD((prev) => ({ ...prev, deckDeleteOpen: false }));
  }

  async function handleAddTopicConfirm() {
    const fc = flashcards.find((f) => f.id === d.activeFlashcardId);
    if (!fc || d.topicActionIds.length === 0) return;
    const currentIds = fc.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [];
    const newIds = [...new Set([...currentIds, ...d.topicActionIds])];
    try {
      await apiPut(`/api/v1/flashcards/${d.activeFlashcardId}`, {
        front: fc.front,
        back: fc.back,
        topicIds: newIds,
      });
      queryClient.invalidateQueries({ queryKey: flashcardQueryKey });
      toast.success(t('topic_added'));
    } catch {
      toast.error(t('save_failed'));
    }
    setD((prev) => ({ ...prev, addTopicOpen: false, topicActionIds: [] }));
  }

  const handleEnterSelectionMode = selection.handleEnterSelectionMode;

  async function handleBulkDelete() {
    const ids = d.selectedIds;
    if (ids.length === 0) return;
    try {
      await batchUnlinkCards.mutateAsync({ ids, deckId });
      selection.handleClearSelection();
      setD((prev) => ({ ...prev, bulkDeleteOpen: false }));
      toast.success(t('flashcard_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
  }

  async function handleBulkLink() {
    const ids = d.selectedIds;
    const deckIds = d.bulkLinkDeckIds;
    if (ids.length === 0 || deckIds.length === 0) return;
    try {
      await batchLinkCards.mutateAsync({ ids, deckIds });
      selection.handleClearSelection();
      setD((prev) => ({ ...prev, bulkLinkOpen: false, bulkLinkDeckIds: [] }));
      toast.success(t('bulk_linked'));
    } catch {
      toast.error(t('link_failed'));
    }
  }

  async function handleBulkTopics() {
    const ids = d.selectedIds;
    const topicIds = d.bulkTopicIds;
    const operation = d.bulkTopicsOperation;
    if (ids.length === 0) return;
    try {
      await batchTopicCards.mutateAsync({ ids, topicIds, operation });
      selection.handleClearSelection();
      setD((prev) => ({ ...prev, bulkTopicsOpen: false, bulkTopicIds: [] }));
      toast.success(t('bulk_topics_updated', { count: ids.length }));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleBulkMove() {
    const ids = d.selectedIds;
    const targetDeckId = d.bulkMoveTargetDeckId;
    if (ids.length === 0 || !targetDeckId) return;
    try {
      await batchMoveCards.mutateAsync({ ids, sourceDeckId: deckId, targetDeckId });
      selection.handleClearSelection();
      setD((prev) => ({ ...prev, bulkMoveOpen: false, bulkMoveTargetDeckId: null }));
      toast.success(t('bulk_moved'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleBulkCopy() {
    const ids = d.selectedIds;
    const targetDeckId = d.bulkCopyTargetDeckId;
    if (ids.length === 0 || !targetDeckId) return;
    try {
      await batchCopyCards.mutateAsync({ ids, targetDeckId });
      selection.handleClearSelection();
      setD((prev) => ({ ...prev, bulkCopyOpen: false, bulkCopyTargetDeckId: null }));
      toast.success(t('flashcard_copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  }

  const h: DialogsHandlers = {
    onDeleteOpenChange: () => setD((prev) => ({ ...prev, deleteId: null })),
    onLinkOpenChange: (open) => setD((prev) => ({ ...prev, linkOpen: open })),
    onCopyOpenChange: (open) => setD((prev) => ({ ...prev, copyOpen: open })),
    onCopyResultClose: () => setD((prev) => ({ ...prev, copyResult: null })),
    onDeckEditOpenChange: (open) => setD((prev) => ({ ...prev, deckEditOpen: open })),
    onDeckDeleteOpenChange: (open) => setD((prev) => ({ ...prev, deckDeleteOpen: open })),
    onViewTopicIdChange: (id) => setD((prev) => ({ ...prev, viewTopicId: id })),
    onAddTopicOpenChange: (open) => setD((prev) => ({ ...prev, addTopicOpen: open })),
    onManageTopicOpenChange: (open) => setD((prev) => ({ ...prev, manageTopicOpen: open })),
    onLinkDeckIdsChange: (linkDeckIds) => setD((prev) => ({ ...prev, linkDeckIds })),
    onCopyTargetDeckIdChange: (copyTargetDeckId) => setD((prev) => ({ ...prev, copyTargetDeckId })),

    onTopicActionIdsChange: (topicActionIds) => setD((prev) => ({ ...prev, topicActionIds })),
    onDelete: handleDelete,
    onLink: handleLink,
    onCopy: handleCopy,
    onDeckUpdate: handleDeckUpdate,
    onDeckDelete: handleDeckDelete,
    onAddTopicConfirm: handleAddTopicConfirm,
    onBulkDelete: handleBulkDelete,
    onBulkLink: handleBulkLink,
    onBulkTopics: handleBulkTopics,
    onBulkMove: handleBulkMove,
    onBulkCopy: handleBulkCopy,
    onBulkTopicsOperationChange: (op) => setD((prev) => ({ ...prev, bulkTopicsOperation: op })),
    onBulkLinkDeckIdsChange: (bulkLinkDeckIds) => setD((prev) => ({ ...prev, bulkLinkDeckIds })),
    onBulkMoveTargetDeckIdChange: (bulkMoveTargetDeckId) =>
      setD((prev) => ({ ...prev, bulkMoveTargetDeckId })),
    onBulkCopyTargetDeckIdChange: (bulkCopyTargetDeckId) =>
      setD((prev) => ({ ...prev, bulkCopyTargetDeckId })),
    onBulkTopicIdsChange: (bulkTopicIds) => setD((prev) => ({ ...prev, bulkTopicIds })),
    onBulkDeleteOpenChange: (open) => setD((prev) => ({ ...prev, bulkDeleteOpen: open })),
    onBulkLinkOpenChange: (open) => setD((prev) => ({ ...prev, bulkLinkOpen: open })),
    onBulkMoveOpenChange: (open) => setD((prev) => ({ ...prev, bulkMoveOpen: open })),
    onBulkCopyOpenChange: (open) => setD((prev) => ({ ...prev, bulkCopyOpen: open })),
    onBulkTopicsOpenChange: (open) => setD((prev) => ({ ...prev, bulkTopicsOpen: open })),
  };

  useEffect(() => {
    const el = document.querySelector('main');
    if (!el) return;
    const onScroll = () => setShowBackToTop(el.scrollTop > 400);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return;
    const update = () => {
      const rect = main.getBoundingClientRect();
      setBarStyle({ left: rect.left, width: rect.width });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== 'n') return;
      if (!can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id)) return;
      e.preventDefault();
      router.push(`${basePath}/decks/${deckId}/new`);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [role, currentDeck?.created_by, user?.id, activeOrg?.id, basePath, deckId, router]);

  if (deckError || (!deckLoading && !currentDeck)) {
    return (
      <div className="space-y-6">
        <EntityNotFound titleKey="deck_not_found" descriptionKey="deck_not_found_desc" />
      </div>
    );
  }

  if (deckLoading) {
    return <DeckDetailSkeleton />;
  }

  return (
    <div className="space-y-6">
      <div className="relative rounded-xl border bg-card p-6">
        <div className="absolute right-4 top-4 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id) && (
                <DropdownMenuItem
                  onClick={() =>
                    setD((prev) => ({
                      ...prev,
                      deckEditOpen: true,
                    }))
                  }
                >
                  <Pencil className="h-4 w-4 mr-2" /> {t('menu_edit')}
                </DropdownMenuItem>
              )}
              {can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setImportOpen(true)}>
                    <FileUp className="h-4 w-4 mr-2" /> {t('common_import')}
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => toggleSuspendMutation.mutate(!currentDeck?.suspended)}
              >
                {currentDeck?.suspended ? (
                  <Eye className="h-4 w-4 mr-2" />
                ) : (
                  <EyeOff className="h-4 w-4 mr-2" />
                )}
                {currentDeck?.suspended ? t('unsuspend_deck') : t('suspend_deck')}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  const params = deckId ? `?deckId=${deckId}` : '';
                  window.open(`/api/v1/flashcards/export/csv${params}`, '_blank');
                }}
              >
                <FileDown className="h-4 w-4 mr-2" /> {t('common_export')}
              </DropdownMenuItem>
              {can(role, 'deck.delete', currentDeck?.created_by, user?.id, activeOrg?.id) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setD((prev) => ({ ...prev, deckDeleteOpen: true }))}
                  >
                    <Trash2 className="h-4 w-4 mr-2" /> {t('menu_delete')}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-2">
            {practiceHref ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    className="group flex h-14 w-14 items-center justify-center rounded-lg bg-muted-foreground/10 hover:bg-muted-foreground/20 transition-colors cursor-pointer"
                    onClick={() => router.push(`${practiceHref}${currentDeck!.id}`)}
                  >
                    <div className="relative h-7 w-7">
                      <Play
                        className="absolute inset-0 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
                        stroke={`url(#hdr-icon)`}
                        strokeWidth="2"
                      />
                      <svg
                        className="absolute inset-0 h-7 w-7 opacity-100 group-hover:opacity-0 transition-opacity duration-200"
                        viewBox="0 0 24 24"
                        fill="none"
                      >
                        <defs>
                          <linearGradient id="hdr-icon" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stopColor={headerGrad.from} />
                            <stop offset="100%" stopColor={headerGrad.to} />
                          </linearGradient>
                        </defs>
                        <path
                          d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                          stroke="url(#hdr-icon)"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">{t('practice_deck')}</TooltipContent>
              </Tooltip>
            ) : (
              <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted-foreground/10">
                <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id="hdr-icon" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={headerGrad.from} />
                      <stop offset="100%" stopColor={headerGrad.to} />
                    </linearGradient>
                  </defs>
                  <path
                    d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                    stroke="url(#hdr-icon)"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            )}
            <Badge variant="secondary">
              {t('flashcards_count', { count: currentDeck!.flashcard_count })}
            </Badge>
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <h2 className="text-2xl font-bold">{currentDeck!.name}</h2>
            {currentDeck!.description && (
              <p className="mt-1 text-muted-foreground">{currentDeck!.description}</p>
            )}
          </div>
        </div>
      </div>

      {currentDeck?.suspended && (
        <Alert variant="default" className="border-dashed text-muted-foreground">
          <EyeOff className="h-4 w-4" />
          <AlertDescription>{t('deck_suspended_notice')}</AlertDescription>
        </Alert>
      )}

      <FlashcardToolbar
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        topicFilter={topicFilter}
        onTopicFilterChange={setTopicFilter}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(sb, so) => {
          setSortBy(sb);
          setSortOrder(so);
        }}
        topics={topics}
        canGenerate={can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id)}
        onGenerate={() => router.push(`/app/ai?deckId=${deckId}`)}
        onCreateNew={() => router.push(`${basePath}/decks/${deckId}/new`)}
        t={t}
      />

      <h3 className="text-lg font-semibold max-sm:block hidden">{t('flashcards_section')}</h3>

      <PageGrid
        isLoading={false}
        skeleton={
          <Card className="group relative sm:min-h-28 max-sm:py-0">
            <div className="sm:hidden px-3 py-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <Skeleton className="h-4 w-3/4 inline-block align-middle" />
                </div>
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
              </div>
              <div className="my-1.5 border-t border-border/50" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3 mt-1" />
            </div>
            <div className="hidden sm:flex sm:flex-col sm:flex-1 sm:px-4 sm:py-3.5">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0 pr-6">
                  <Skeleton className="h-5 w-3/4" />
                </div>
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
              </div>
              <div className="my-2 border-t border-border/50" />
              <div className="flex-1 space-y-1.5 min-w-0">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-2/3" />
              </div>
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                <Skeleton className="h-5 w-16 rounded-full" />
                <Skeleton className="h-5 w-20 rounded-full" />
              </div>
            </div>
          </Card>
        }
        skeletonCount={6}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        isEmpty={flashcards.length === 0}
        emptyIcon={<Layers className="h-10 w-10 text-muted-foreground" />}
        emptyTitle={t('no_flashcards')}
        emptyAction={
          can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id) ? (
            <Button
              variant="outline"
              size="sm"
              disabled={!canCreateFlashcard.hasAccess}
              onClick={
                canCreateFlashcard.hasAccess
                  ? () => router.push(`${basePath}/decks/${deckId}/new`)
                  : () => router.push('/checkout?plan_id=student_premium')
              }
              aria-keyshortcuts="n"
            >
              {canCreateFlashcard.hasAccess ? (
                <>
                  <Plus className="mr-1.5 h-4 w-4" /> {t('create_first')}
                </>
              ) : (
                <>
                  <Lock className="size-3" /> Upgrade
                </>
              )}
            </Button>
          ) : undefined
        }
      >
        {flashcards.map((fc) => (
          <FlashcardCard
            key={fc.id}
            fc={fc}
            canUpdate={can(role, 'flashcard.update', fc.created_by, user?.id, activeOrg?.id)}
            canDelete={
              can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id) ?? false
            }
            topics={topics}
            t={t}
            selected={selection.selectedIds.has(fc.id)}
            selectable={selection.isSelecting}
            onToggleSelect={selection.toggleSelect}
            onEnterSelectionMode={handleEnterSelectionMode}
            onEdit={openEdit}
            onDelete={handleCardDelete}
            onLink={handleCardLink}
            onCopy={handleCardCopy}
            onAddTopic={handleCardAddTopic}
            onManageTopics={handleCardManageTopics}
            onViewByTopic={handleCardViewByTopic}
          />
        ))}
      </PageGrid>

      {(() => {
        const selectedFlashcards = flashcards.filter((fc) => selection.selectedIds.has(fc.id));
        const canBulkTopics =
          selectedFlashcards.length > 0 &&
          selectedFlashcards.every((fc) =>
            can(role, 'flashcard.update', fc.created_by, user?.id, activeOrg?.id),
          );
        const canBulkMove =
          (can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id) ?? false) &&
          selectedFlashcards.every((fc) =>
            can(role, 'flashcard.update', fc.created_by, user?.id, activeOrg?.id),
          );
        return (
          <BulkActionBar
            selectedCount={selection.selectedIds.size}
            onClearSelection={selection.handleClearSelection}
          >
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setD((prev) => ({
                  ...prev,
                  bulkCopyOpen: true,
                  bulkCopyTargetDeckId: null,
                  selectedIds: Array.from(selection.selectedIds),
                }))
              }
            >
              <Copy className="mr-1.5 h-4 w-4" /> {t('common_copy')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const ids = Array.from(selection.selectedIds).join(',');
                window.open(`/api/v1/flashcards/export/csv?ids=${ids}`, '_blank');
              }}
            >
              <Download className="mr-1.5 h-4 w-4" /> {t('common_export')}
            </Button>
            {canBulkTopics && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setD((prev) => ({
                    ...prev,
                    bulkTopicsOpen: true,
                    bulkTopicIds: [],
                    bulkTopicsOperation: 'set',
                    selectedIds: Array.from(selection.selectedIds),
                  }))
                }
              >
                <Tags className="mr-1.5 h-4 w-4" /> {t('topics')}
              </Button>
            )}
            {canBulkMove && (
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setD((prev) => ({
                    ...prev,
                    bulkMoveOpen: true,
                    bulkMoveTargetDeckId: null,
                    selectedIds: Array.from(selection.selectedIds),
                  }))
                }
              >
                <ArrowRight className="mr-1.5 h-4 w-4" /> {t('move')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                setD((prev) => ({
                  ...prev,
                  bulkLinkOpen: true,
                  bulkLinkDeckIds: [],
                  selectedIds: Array.from(selection.selectedIds),
                }))
              }
            >
              <Link2 className="mr-1.5 h-4 w-4" /> {t('link')}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() =>
                setD((prev) => ({
                  ...prev,
                  bulkDeleteOpen: true,
                  selectedIds: Array.from(selection.selectedIds),
                }))
              }
            >
              <Trash2 className="mr-1.5 h-4 w-4" /> {t('common_delete')}
            </Button>
          </BulkActionBar>
        );
      })()}

      <Suspense fallback={null}>
        <DeckDetailDialogs
          state={d}
          handlers={h}
          flashcards={flashcards}
          currentDeck={currentDeck ?? null}
          allDecks={allDecks}
          topics={topics}
          t={t}
          basePath={basePath}
        />
      </Suspense>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} deckId={deckId} t={t} />

      {!selection.isSelecting && (
        <div className="sm:hidden">
          <SpeedDial
            items={[
              ...(can(role, 'deck.update', currentDeck?.created_by, user?.id, activeOrg?.id)
                ? [
                    {
                      icon: Plus,
                      label: canCreateFlashcard.hasAccess ? t('new_flashcard') : 'Upgrade',
                      onClick: canCreateFlashcard.hasAccess
                        ? () => router.push(`${basePath}/decks/${deckId}/new`)
                        : () => router.push('/checkout?plan_id=student_premium'),
                    },
                  ]
                : []),
              {
                icon: Sparkles,
                label:
                  canCreateFlashcard.hasAccess && canAIChat.hasAccess ? t('generate') : 'Upgrade',
                onClick:
                  canCreateFlashcard.hasAccess && canAIChat.hasAccess
                    ? () => router.push(`/app/ai?deckId=${deckId}`)
                    : () => router.push('/checkout?plan_id=student_premium'),
              },
            ]}
          />
        </div>
      )}

      <ScrollBackToBar
        chevronDirection="up"
        barPosition="bottom"
        visible={showBackToTop}
        onClick={() => document.querySelector('main')?.scrollTo({ top: 0, behavior: 'smooth' })}
        style={barStyle}
        className="fixed bottom-0 z-50"
      />
    </div>
  );
}
