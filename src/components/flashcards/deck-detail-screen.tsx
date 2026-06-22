'use client';

import { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { EntityNotFound } from '@/components/shared/entity-not-found';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  CheckSquare,
  Square,
  CheckCheck,
  Upload,
  Download,
  Sparkles,
  Layers,
  MoreVertical,
} from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { BreadcrumbUpdater } from '@/components/providers/BreadcrumbProvider';
import { toast } from 'sonner';
import { useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import { FlashcardCard } from '@/components/flashcards/flashcard-card';
import { FlashcardBulkActions } from '@/components/flashcards/flashcard-bulk-actions';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
const DeckDetailDialogs = lazy(() =>
  import('@/components/flashcards/deck-detail-dialogs').then((mod) => ({
    default: mod.DeckDetailDialogs,
  })),
);
type DialogsState = import('@/components/flashcards/deck-detail-dialogs').DialogsState;
type DialogsHandlers = import('@/components/flashcards/deck-detail-dialogs').DialogsHandlers;
import { ImportDialog } from '@/components/flashcards/import-dialog';
import { SpeedDial } from '@/components/shared/speed-dial';
import type { Deck, Flashcard, Topic } from '@/types/flashcards';
import { useAuth } from '@/components/providers/AuthProvider';
import { can } from '@/lib/frontend-rbac';
import { UserRole } from '@/types';
import { getGradientHex } from '@/lib/color-utils';

interface DeckDetailScreenProps {
  deckId: string;
  basePath: string;
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
  practiceHref?: string;
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
  const headerGrad = getGradientHex(deckId);

  const {
    data: flashcardsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: flashcardKeys.list({ deckIds: [deckId] }),
    queryFn: ({ pageParam }) =>
      apiGet<{ items: Flashcard[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/flashcards?deckIds=${deckId}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    enabled: !!deckId,
    staleTime: Infinity,
    refetchOnMount: false,
  });
  const { data: topicsData } = useApiQuery<Topic[]>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics',
  });
  const { data: allDecksData, isLoading: decksLoading } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks',
  });

  const flashcards = flashcardsData?.pages.flatMap((page) => page.items) ?? [];
  const currentDeck = allDecksData?.find((d) => d.id === deckId) ?? null;
  const deckLoading = decksLoading;
  const deckError = !decksLoading && !currentDeck;
  const topics = topicsData ?? [];
  const allDecks = (allDecksData ?? []).filter((d) => d.id !== deckId);
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
    invalidateKeys: [flashcardKeys.decks.all],
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all });
      const prev = queryClient.getQueryData<Deck[]>(flashcardKeys.decks.all);
      queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) =>
        old?.map((d) => (d.id === id ? { ...d, ...data } : d)),
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous);
    },
  });
  const deleteDeck = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/decks/${id}`),
    invalidateKeys: [flashcardKeys.decks.all],
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all });
      const prev = queryClient.getQueryData<Deck[]>(flashcardKeys.decks.all);
      queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) =>
        old?.filter((d) => d.id !== id),
      );
      return { previous: prev };
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous);
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

  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

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
    deckFormData: { name: '', description: '' },
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

  function openEdit(fc: Flashcard) {
    router.push(`${basePath}/deck/${deckId}/${fc.id}`);
  }

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

  async function handleDeckUpdate() {
    if (!d.deckFormData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    setD((prev) => ({ ...prev, deckEditOpen: false }));
    try {
      await updateDeck.mutateAsync({
        id: deckId,
        name: d.deckFormData.name,
        description: d.deckFormData.description || undefined,
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

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
  }

  async function handleBulkDelete() {
    const ids = d.selectedIds;
    if (ids.length === 0) return;
    try {
      await batchUnlinkCards.mutateAsync({ ids, deckId });
      clearSelection();
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
      clearSelection();
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
      clearSelection();
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
      clearSelection();
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
      clearSelection();
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
    onDeckFormDataChange: (deckFormData) => setD((prev) => ({ ...prev, deckFormData })),
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
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key !== 'n') return;
      if (!can(role, 'deck.update', currentDeck?.created_by, user?.id)) return;
      e.preventDefault();
      router.push(`${basePath}/deck/${deckId}/new`);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [role, currentDeck?.created_by, user?.id, basePath, deckId, router]);

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
      <BreadcrumbUpdater label={currentDeck?.name ?? ''} href="#" />

      <div className="relative rounded-xl border bg-card p-6">
        <div className="absolute right-4 top-4 z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
                <DropdownMenuItem
                  onClick={() =>
                    setD((prev) => ({
                      ...prev,
                      deckEditOpen: true,
                      deckFormData: {
                        name: currentDeck?.name ?? '',
                        description: currentDeck?.description ?? '',
                      },
                    }))
                  }
                >
                  <Pencil className="h-4 w-4 mr-2" /> {t('menu_edit')}
                </DropdownMenuItem>
              )}
              {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
                <DropdownMenuItem onClick={() => setImportOpen(true)}>
                  <Upload className="h-4 w-4 mr-2" /> {t('import_csv')}
                </DropdownMenuItem>
              )}
              <DropdownMenuItem
                onClick={() => {
                  const params = deckId ? `?deckId=${deckId}` : '';
                  window.open(`/api/v1/flashcards/export/csv${params}`, '_blank');
                }}
              >
                <Download className="h-4 w-4 mr-2" /> {t('export_csv')}
              </DropdownMenuItem>
              {can(role, 'deck.delete', currentDeck?.created_by, user?.id) && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
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
            <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-muted-foreground/10">
              <svg className="h-7 w-7" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id="hdr-icon" x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={headerGrad.from} />
                    <stop offset="100%" stopColor={headerGrad.to} />
                  </linearGradient>
                </defs>
                <path d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" stroke="url(#hdr-icon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
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

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('flashcards_section')}</h3>
          <p className="text-sm text-muted-foreground">{t('flip_hint')}</p>
        </div>
        <div className="flex items-center gap-2">
          {practiceHref && (
            <Button variant="outline" size="sm" className="gap-1" asChild>
              <Link href={`${practiceHref}${currentDeck!.id}`}>
                <Play className="h-3 w-3" /> {t('practice_deck')}
              </Link>
            </Button>
          )}
          {isSelecting && (
            <Button variant="outline" size="sm" onClick={clearSelection}>
              <Square className="mr-2 h-4 w-4" /> {t('cancel_selection')}
            </Button>
          )}
        </div>
      </div>

      <div
        className={`flex items-center gap-2 py-1 ${isSelecting && flashcards.length > 0 ? '' : 'invisible'}`}
      >
        {isSelecting && flashcards.length > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allSelected = flashcards.every((fc) => selectedIds.has(fc.id));
                if (allSelected) {
                  handleDeselectAll();
                } else {
                  setSelectedIds(new Set(flashcards.map((fc) => fc.id)));
                }
              }}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              {flashcards.every((fc) => selectedIds.has(fc.id))
                ? t('deselect_all')
                : t('select_all')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('n_selected', { count: selectedIds.size })}
            </span>
          </>
        )}
      </div>

      {flashcards.length === 0 ? (
        <Empty>
          <EmptyMedia>
            <Layers className="h-10 w-10 text-muted-foreground" />
          </EmptyMedia>
          <EmptyTitle>{t('no_flashcards')}</EmptyTitle>
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <EmptyDescription>
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(`${basePath}/deck/${deckId}/new`)}
                aria-keyshortcuts="n"
              >
                <Plus className="mr-1.5 h-4 w-4" /> {t('create_first')}
              </Button>
            </EmptyDescription>
          )}
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flashcards.map((fc) => (
            <FlashcardCard
              key={fc.id}
              fc={fc}
              isFlipped={flippedId === fc.id}
              canUpdate={can(role, 'flashcard.update', fc.created_by, user?.id)}
              canDelete={can(role, 'deck.update', currentDeck?.created_by, user?.id) ?? false}
              topics={topics}
              t={t}
              selected={selectedIds.has(fc.id)}
              selectable={isSelecting}
              onToggleSelect={toggleSelect}
              onFlip={isSelecting ? () => {} : (id) => setFlippedId(id || null)}
              onEdit={openEdit}
              onDelete={(id) => setD((prev) => ({ ...prev, deleteId: id }))}
              onLink={(fc) =>
                setD((prev) => ({
                  ...prev,
                  activeFlashcardId: fc.id,
                  linkDeckIds: [],
                  linkOpen: true,
                }))
              }
              onCopy={(fc) =>
                setD((prev) => ({
                  ...prev,
                  activeFlashcardId: fc.id,
                  copyTargetDeckId: null,
                  copyOpen: true,
                }))
              }
              onAddTopic={(fc) =>
                setD((prev) => ({
                  ...prev,
                  activeFlashcardId: fc.id,
                  topicActionIds: [],
                  addTopicOpen: true,
                }))
              }
              onManageTopics={(fc) =>
                setD((prev) => ({ ...prev, activeFlashcardId: fc.id, manageTopicOpen: true }))
              }
              onViewByTopic={(_fc, topicId) => setD((prev) => ({ ...prev, viewTopicId: topicId }))}
            />
          ))}
          <div ref={loadMoreRef} className="col-span-full h-4" />
          {isFetchingNextPage && (
            <div className="col-span-full flex justify-center py-4">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            </div>
          )}
        </div>
      )}

      {(() => {
        const selectedFlashcards = flashcards.filter((fc) => selectedIds.has(fc.id));
        const canBulkTopics =
          selectedFlashcards.length > 0 &&
          selectedFlashcards.every((fc) => can(role, 'flashcard.update', fc.created_by, user?.id));
        const canBulkMove =
          (can(role, 'deck.update', currentDeck?.created_by, user?.id) ?? false) &&
          selectedFlashcards.every((fc) => can(role, 'flashcard.update', fc.created_by, user?.id));
        return (
          <FlashcardBulkActions
            selectedCount={selectedIds.size}
            canDelete={can(role, 'deck.update', currentDeck?.created_by, user?.id) ?? false}
            canTopics={canBulkTopics}
            canMove={canBulkMove}
            canExport={selectedIds.size > 0}
            onDelete={() =>
              setD((prev) => ({
                ...prev,
                bulkDeleteOpen: true,
                selectedIds: Array.from(selectedIds),
              }))
            }
            onLink={() =>
              setD((prev) => ({
                ...prev,
                bulkLinkOpen: true,
                bulkLinkDeckIds: [],
                selectedIds: Array.from(selectedIds),
              }))
            }
            onTopics={() =>
              setD((prev) => ({
                ...prev,
                bulkTopicsOpen: true,
                bulkTopicIds: [],
                bulkTopicsOperation: 'set',
                selectedIds: Array.from(selectedIds),
              }))
            }
            onCopy={() =>
              setD((prev) => ({
                ...prev,
                bulkCopyOpen: true,
                bulkCopyTargetDeckId: null,
                selectedIds: Array.from(selectedIds),
              }))
            }
            onMove={() =>
              setD((prev) => ({
                ...prev,
                bulkMoveOpen: true,
                bulkMoveTargetDeckId: null,
                selectedIds: Array.from(selectedIds),
              }))
            }
            onExport={() => {
              const ids = Array.from(selectedIds).join(',');
              window.open(`/api/v1/flashcards/export/csv?ids=${ids}`, '_blank');
            }}
            onClearSelection={clearSelection}
            t={t}
          />
        );
      })()}

      <Suspense fallback={null}>
        <DeckDetailDialogs
          state={d}
          handlers={h}
          flashcards={flashcards}
          currentDeck={currentDeck}
          allDecks={allDecks}
          topics={topics}
          t={t}
          basePath={basePath}
        />
      </Suspense>

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} deckId={deckId} t={t} />

      {!isSelecting && (
        <SpeedDial
          items={[
            ...(can(role, 'deck.update', currentDeck?.created_by, user?.id)
              ? [
                  {
                    icon: Plus,
                    label: t('new_flashcard'),
                    onClick: () => router.push(`${basePath}/deck/${deckId}/new`),
                  },
                ]
              : []),

            {
              icon: Sparkles,
              label: t('generate'),
              onClick: () => router.push(`/app/ai?deckId=${deckId}`),
            },
            { icon: CheckSquare, label: t('select_cards'), onClick: () => setIsSelecting(true) },
          ]}
        />
      )}
    </div>
  );
}
