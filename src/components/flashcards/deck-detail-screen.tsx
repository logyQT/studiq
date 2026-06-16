'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
  Menu,
} from 'lucide-react';
import { BreadcrumbUpdater } from '@/components/providers/BreadcrumbProvider';
import { toast } from 'sonner';
import { useQueryClient, useInfiniteQuery } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import { FlashcardCard } from '@/components/flashcards/flashcard-card';
import { FlashcardBulkActions } from '@/components/flashcards/flashcard-bulk-actions';
import { TooltipProvider, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { DeckDetailDialogs, type DialogsState, type DialogsHandlers } from '@/components/flashcards/deck-detail-dialogs';
import { ImportDialog } from '@/components/flashcards/import-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { Deck, Flashcard, Topic } from '@/types/flashcards';
import { useAuth } from '@/components/providers/AuthProvider';
import { can } from '@/lib/frontend-rbac';
import { UserRole } from '@/types';

const GRADIENTS = [
  'from-violet-500 to-purple-600', 'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600', 'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600', 'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600', 'from-lime-500 to-green-600',
  'from-red-500 to-orange-500', 'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500', 'from-teal-500 to-emerald-600',
];

function getGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

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
  const gradient = getGradient(deckId);
  const searchParams = useSearchParams();
  const highlightParam = searchParams.get('highlight');
  const [highlightId, setHighlightId] = useState<string | null>(null);

  useEffect(() => {
    if (highlightParam) {
      setHighlightId(highlightParam);
    }
  }, [highlightParam]);

  const { data: currentDeckData, isLoading: deckLoading, isError: deckError } = useApiQuery<Deck>({
    queryKey: flashcardKeys.decks.detail(deckId),
    url: `/api/v1/flashcards/decks/${deckId}`,
    enabled: !!deckId,
  });
  const { data: flashcardsData, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: flashcardKeys.list({ deckIds: [deckId] }),
    queryFn: ({ pageParam }) =>
      apiGet<{ items: Flashcard[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/flashcards?deckIds=${deckId}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    enabled: !!deckId,
  });
  const { data: topicsData } = useApiQuery<Topic[]>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics',
  });
  const { data: allDecksData } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks',
  });

  const flashcards = flashcardsData?.pages.flatMap((page) => page.items) ?? [];
  const currentDeck = currentDeckData ?? null;
  const topics = topicsData ?? [];
  const allDecks = (allDecksData ?? []).filter((d) => d.id !== deckId);
  const flashcardQueryKey = flashcardKeys.list({ deckIds: [deckId] });

  useEffect(() => {
    if (!highlightId || flashcards.length === 0) return;
    const timer = setTimeout(() => {
      document.getElementById(`fc-${highlightId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
    return () => clearTimeout(timer);
  }, [highlightId, flashcards.length]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => {
      window.history.replaceState(null, '', window.location.pathname);
      setHighlightId(null);
    }, 3000);
    return () => clearTimeout(timer);
  }, [highlightId]);

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
    onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous); },
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
    onError: (_err, _id, ctx) => { queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous); },
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
    onBulkMoveTargetDeckIdChange: (bulkMoveTargetDeckId) => setD((prev) => ({ ...prev, bulkMoveTargetDeckId })),
    onBulkCopyTargetDeckIdChange: (bulkCopyTargetDeckId) => setD((prev) => ({ ...prev, bulkCopyTargetDeckId })),
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

      <div className={`relative group rounded-xl bg-gradient-to-br ${gradient} p-8 text-white`}>
        <div className="absolute inset-0 rounded-xl bg-black/10 pointer-events-none" />
        <div className="absolute right-4 top-4 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <TooltipProvider delayDuration={500}>
            {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
              <TooltipPrimitive.Root>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20"
                    onClick={() => setD((prev) => ({ ...prev, deckEditOpen: true, deckFormData: { name: currentDeck?.name ?? '', description: currentDeck?.description ?? '' } }))}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('menu_edit')}</TooltipContent>
              </TooltipPrimitive.Root>
            )}
            {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
              <TooltipPrimitive.Root>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('import_csv')}</TooltipContent>
              </TooltipPrimitive.Root>
            )}
            <TooltipPrimitive.Root>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20"
                  onClick={() => {
                    const params = deckId ? `?deckId=${deckId}` : '';
                    window.open(`/api/v1/flashcards/export/csv${params}`, '_blank');
                  }}
                >
                  <Download className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('export_csv')}</TooltipContent>
            </TooltipPrimitive.Root>
            {can(role, 'deck.delete', currentDeck?.created_by, user?.id) && (
              <TooltipPrimitive.Root>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-red-200 hover:bg-white/20"
                    onClick={() => setD((prev) => ({ ...prev, deckDeleteOpen: true }))}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('menu_delete')}</TooltipContent>
              </TooltipPrimitive.Root>
            )}
          </TooltipProvider>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/20 text-2xl font-bold">
            {currentDeck!.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{currentDeck!.name}</h2>
            {currentDeck!.description && (
              <p className="mt-1 text-white/80">{currentDeck!.description}</p>
            )}
            <div className="mt-3 flex items-center gap-4">
              <Badge variant="secondary" className="bg-white/20 text-white">
                {t('flashcards_count', { count: flashcards.length })}
              </Badge>
              {practiceHref && (
                <Button variant="secondary" size="sm" className="bg-white/20 text-white hover:bg-white/30 gap-1" asChild>
                  <Link href={`${practiceHref}${currentDeck!.id}`}>
                    <Play className="h-3 w-3" /> {t('practice_deck')}
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('flashcards_section')}</h3>
          <p className="text-sm text-muted-foreground">{t('flip_hint')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden md:flex items-center gap-2">
            <Button
              variant={isSelecting ? 'secondary' : 'outline'}
              onClick={() => {
                if (isSelecting) clearSelection();
                else setIsSelecting(true);
              }}
            >
              {isSelecting ? <Square className="mr-2 h-4 w-4" /> : <CheckSquare className="mr-2 h-4 w-4" />}
              {isSelecting ? t('cancel_selection') : t('select_cards')}
            </Button>
            {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
              <>
                <Button onClick={() => router.push(`${basePath}/deck/${deckId}/new`)} aria-keyshortcuts="n">
                  <Plus className="mr-2 h-4 w-4" /> {t('new_flashcard')}
                </Button>

              </>
            )}
          </div>
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm">
                  <Menu className="mr-2 h-4 w-4" /> {t('common_manage')}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => {
                  if (isSelecting) clearSelection();
                  else setIsSelecting(true);
                }}>
                  {isSelecting ? <Square className="mr-2 h-4 w-4" /> : <CheckSquare className="mr-2 h-4 w-4" />}
                  {isSelecting ? t('cancel_selection') : t('select_cards')}
                </DropdownMenuItem>
                {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => router.push(`${basePath}/deck/${deckId}/new`)}>
                      <Plus className="mr-2 h-4 w-4" /> {t('new_flashcard')}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className={`flex items-center gap-2 py-1 ${isSelecting && flashcards.length > 0 ? '' : 'invisible'}`}>
        {isSelecting && flashcards.length > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allSelected = flashcards.every(fc => selectedIds.has(fc.id));
                if (allSelected) {
                  handleDeselectAll();
                } else {
                  setSelectedIds(new Set(flashcards.map(fc => fc.id)));
                }
              }}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              {flashcards.every(fc => selectedIds.has(fc.id)) ? t('deselect_all') : t('select_all')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('n_selected', { count: selectedIds.size })}
            </span>
          </>
        )}
      </div>

      {flashcards.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">{t('no_flashcards')}</p>
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <Button variant="outline" className="mt-4" onClick={() => router.push(`${basePath}/deck/${deckId}/new`)} aria-keyshortcuts="n">
              <Plus className="mr-2 h-4 w-4" /> {t('create_first')}
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flashcards.map((fc) => (
            <FlashcardCard
              key={fc.id}
              fc={fc}
              isFlipped={flippedId === fc.id}
              gradient={gradient}
              canUpdate={can(role, 'flashcard.update', fc.created_by, user?.id)}
              canDelete={can(role, 'deck.update', currentDeck?.created_by, user?.id) ?? false}
              topics={topics}
              t={t}
              selected={selectedIds.has(fc.id)}
              highlighted={fc.id === highlightId}
              selectable={isSelecting}
              onToggleSelect={toggleSelect}
              onFlip={isSelecting ? () => {} : (id) => setFlippedId(id || null)}
              onEdit={openEdit}
              onDelete={(id) => setD((prev) => ({ ...prev, deleteId: id }))}
              onLink={(fc) => setD((prev) => ({ ...prev, activeFlashcardId: fc.id, linkDeckIds: [], linkOpen: true }))}
              onCopy={(fc) => setD((prev) => ({ ...prev, activeFlashcardId: fc.id, copyTargetDeckId: null, copyOpen: true }))}
              onAddTopic={(fc) => setD((prev) => ({ ...prev, activeFlashcardId: fc.id, topicActionIds: [], addTopicOpen: true }))}
              onManageTopics={(fc) => setD((prev) => ({ ...prev, activeFlashcardId: fc.id, manageTopicOpen: true }))}
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
        const canBulkTopics = selectedFlashcards.length > 0 &&
          selectedFlashcards.every((fc) => can(role, 'flashcard.update', fc.created_by, user?.id));
        const canBulkMove = (can(role, 'deck.update', currentDeck?.created_by, user?.id) ?? false) &&
          selectedFlashcards.every((fc) => can(role, 'flashcard.update', fc.created_by, user?.id));
        return (
          <FlashcardBulkActions
            selectedCount={selectedIds.size}
            canDelete={can(role, 'deck.update', currentDeck?.created_by, user?.id) ?? false}
            canTopics={canBulkTopics}
            canMove={canBulkMove}
            canExport={selectedIds.size > 0}
            onDelete={() => setD((prev) => ({ ...prev, bulkDeleteOpen: true, selectedIds: Array.from(selectedIds) }))}
            onLink={() => setD((prev) => ({ ...prev, bulkLinkOpen: true, bulkLinkDeckIds: [], selectedIds: Array.from(selectedIds) }))}
            onTopics={() => setD((prev) => ({ ...prev, bulkTopicsOpen: true, bulkTopicIds: [], bulkTopicsOperation: 'set', selectedIds: Array.from(selectedIds) }))}
            onCopy={() => setD((prev) => ({ ...prev, bulkCopyOpen: true, bulkCopyTargetDeckId: null, selectedIds: Array.from(selectedIds) }))}
            onMove={() => setD((prev) => ({ ...prev, bulkMoveOpen: true, bulkMoveTargetDeckId: null, selectedIds: Array.from(selectedIds) }))}
            onExport={() => {
              const ids = Array.from(selectedIds).join(',');
              window.open(`/api/v1/flashcards/export/csv?ids=${ids}`, '_blank');
            }}
            onClearSelection={clearSelection}
            t={t}
          />
        );
      })()}

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

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        deckId={deckId}
        t={t}
      />
    </div>
  );
}
