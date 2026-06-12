'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Plus,
  Pencil,
  Trash2,
  Play,
  CheckSquare,
  Square,
  CheckCheck,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import { FlashcardCard } from '@/components/flashcards/flashcard-card';
import { FlashcardBulkActions } from '@/components/flashcards/flashcard-bulk-actions';
import { DeckDetailDialogs, type DialogsState, type DialogsHandlers } from '@/components/flashcards/deck-detail-dialogs';
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
  parentBreadcrumbs: { label: string; href: string }[];
}

export function DeckDetailScreen({
  deckId,
  basePath,
  apiBase,
  t,
  practiceHref,
  parentBreadcrumbs,
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
  const { data: flashcardsData } = useApiQuery<Flashcard[]>({
    queryKey: flashcardKeys.list({ deckIds: [deckId] }),
    url: `/api/v1/flashcards?deckIds=${deckId}`,
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

  const flashcards = flashcardsData ?? [];
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

  const createFlashcard = useApiMutation({
    mutationFn: (data: { front: string; back: string; topicIds?: string[] }) =>
      apiPost<Flashcard>('/api/v1/flashcards', { ...data, deckId }),
    invalidateKeys: [flashcardQueryKey],
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: flashcardQueryKey });
      const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey);
      const tempCard: Flashcard = {
        id: `temp-${Date.now()}`,
        front: data.front,
        back: data.back,
        created_by: user?.id ?? '',
        flashcard_topic_assignments: data.topicIds?.map((topic_id) => ({ topic_id })) ?? [],
        flashcard_deck_assignments: [{ deck_id: deckId }],
      };
      queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) =>
        [tempCard, ...(old ?? [])],
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); },
  });
  const updateFlashcard = useApiMutation({
    mutationFn: ({ id, ...data }: { id: string; front: string; back: string; topicIds: string[] }) =>
      apiPut<Flashcard>(`/api/v1/flashcards/${id}`, data),
    invalidateKeys: [flashcardQueryKey],
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey: flashcardQueryKey });
      const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey);
      queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) =>
        old?.map((fc) => (fc.id === id ? { ...fc, ...data } : fc)),
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); },
  });
  const unlinkFlashcard = useApiMutation({
    mutationFn: (data: { id: string; deckId: string }) =>
      apiPost(`/api/v1/flashcards/${data.id}/unlink`, { deckId: data.deckId }),
    invalidateKeys: [flashcardQueryKey],
    onMutate: async ({ id }) => {
      await queryClient.cancelQueries({ queryKey: flashcardQueryKey });
      const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey);
      queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) =>
        old?.filter((fc) => fc.id !== id),
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); },
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
    onMutate: async ({ ids }) => {
      await queryClient.cancelQueries({ queryKey: flashcardQueryKey });
      const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey);
      queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) =>
        old?.filter((fc) => !ids.includes(fc.id)),
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); },
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
    onMutate: async ({ ids, topicIds, operation }) => {
      await queryClient.cancelQueries({ queryKey: flashcardQueryKey });
      const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey);
      queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) =>
        old?.map((fc) => {
          if (!ids.includes(fc.id)) return fc;
          const currentIds = fc.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [];
          let newIds: string[];
          if (operation === 'add') {
            newIds = [...new Set([...currentIds, ...topicIds])];
          } else if (operation === 'remove') {
            newIds = currentIds.filter((id) => !topicIds.includes(id));
          } else {
            newIds = topicIds;
          }
          return {
            ...fc,
            flashcard_topic_assignments: newIds.map((topic_id) => ({ topic_id })),
          };
        }),
      );
      return { previous: prev };
    },
    onError: (_err, _data, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); },
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
    onMutate: async (data) => {
      await queryClient.cancelQueries({ queryKey: flashcardQueryKey });
      const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey);
      queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) =>
        old?.filter((fc) => !data.ids.includes(fc.id)),
      );
      return { previous: prev };
    },
    onError: (_err, _data, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); },
  });

  const [flippedId, setFlippedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelecting, setIsSelecting] = useState(false);

  const [d, setD] = useState<DialogsState>({
    createOpen: false,
    editOpen: false,
    deleteId: null,
    linkOpen: false,
    copyOpen: false,
    copyResult: null,
    activeFlashcardId: null,
    formData: { front: '', back: '', topicIds: [] },
    linkDeckIds: [],
    copyTargetDeckId: null,
    deckEditOpen: false,
    deckDeleteOpen: false,
    deckFormData: { name: '', description: '' },
    viewTopicId: null,
    addTopicOpen: false,
    removeTopicOpen: false,
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

  function resetForm() {
    setD((prev) => ({ ...prev, formData: { front: '', back: '', topicIds: [] } }));
  }

  function openEdit(fc: Flashcard) {
    setD((prev) => ({
      ...prev,
      formData: {
        front: fc.front,
        back: fc.back,
        topicIds: fc.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [],
      },
      activeFlashcardId: fc.id,
      editOpen: true,
    }));
  }

  async function handleCreate() {
    if (!d.formData.front.trim() || !d.formData.back.trim()) {
      toast.error(t('front_back_required'));
      return;
    }
    try {
      await createFlashcard.mutateAsync({
        front: d.formData.front,
        back: d.formData.back,
        topicIds: d.formData.topicIds.length > 0 ? d.formData.topicIds : undefined,
      });
      setD((prev) => ({ ...prev, createOpen: false }));
      resetForm();
      toast.success(t('flashcard_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleUpdate() {
    if (!d.activeFlashcardId) return;
    if (!d.formData.front.trim() || !d.formData.back.trim()) {
      toast.error(t('front_back_required'));
      return;
    }
    try {
      await updateFlashcard.mutateAsync({
        id: d.activeFlashcardId,
        front: d.formData.front,
        back: d.formData.back,
        topicIds: d.formData.topicIds,
      });
      setD((prev) => ({ ...prev, editOpen: false }));
      resetForm();
      toast.success(t('flashcard_updated'));
    } catch {
      toast.error(t('save_failed'));
    }
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
      await updateFlashcard.mutateAsync({
        id: d.activeFlashcardId!,
        front: fc.front,
        back: fc.back,
        topicIds: newIds,
      });
      toast.success(t('topic_added'));
    } catch {
      toast.error(t('save_failed'));
    }
    setD((prev) => ({ ...prev, addTopicOpen: false, topicActionIds: [] }));
  }

  async function handleRemoveTopicConfirm() {
    const fc = flashcards.find((f) => f.id === d.activeFlashcardId);
    if (!fc || d.topicActionIds.length === 0) return;
    const currentIds = fc.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [];
    const newIds = currentIds.filter((id) => !d.topicActionIds.includes(id));
    try {
      await updateFlashcard.mutateAsync({
        id: d.activeFlashcardId!,
        front: fc.front,
        back: fc.back,
        topicIds: newIds,
      });
      toast.success(t('topic_removed'));
    } catch {
      toast.error(t('save_failed'));
    }
    setD((prev) => ({ ...prev, removeTopicOpen: false, topicActionIds: [] }));
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
    onCreateOpenChange: (open) => { setD((prev) => ({ ...prev, createOpen: open })); if (!open) resetForm(); },
    onEditOpenChange: (open) => { setD((prev) => ({ ...prev, editOpen: open })); if (!open) resetForm(); },
    onDeleteOpenChange: () => setD((prev) => ({ ...prev, deleteId: null })),
    onLinkOpenChange: (open) => setD((prev) => ({ ...prev, linkOpen: open })),
    onCopyOpenChange: (open) => setD((prev) => ({ ...prev, copyOpen: open })),
    onCopyResultClose: () => setD((prev) => ({ ...prev, copyResult: null })),
    onDeckEditOpenChange: (open) => setD((prev) => ({ ...prev, deckEditOpen: open })),
    onDeckDeleteOpenChange: (open) => setD((prev) => ({ ...prev, deckDeleteOpen: open })),
    onViewTopicIdChange: (id) => setD((prev) => ({ ...prev, viewTopicId: id })),
    onAddTopicOpenChange: (open) => setD((prev) => ({ ...prev, addTopicOpen: open })),
    onRemoveTopicOpenChange: (open) => setD((prev) => ({ ...prev, removeTopicOpen: open })),
    onFormDataChange: (formData) => setD((prev) => ({ ...prev, formData })),
    onLinkDeckIdsChange: (linkDeckIds) => setD((prev) => ({ ...prev, linkDeckIds })),
    onCopyTargetDeckIdChange: (copyTargetDeckId) => setD((prev) => ({ ...prev, copyTargetDeckId })),
    onDeckFormDataChange: (deckFormData) => setD((prev) => ({ ...prev, deckFormData })),
    onTopicActionIdsChange: (topicActionIds) => setD((prev) => ({ ...prev, topicActionIds })),
    onCreate: handleCreate,
    onUpdate: handleUpdate,
    onDelete: handleDelete,
    onLink: handleLink,
    onCopy: handleCopy,
    onDeckUpdate: handleDeckUpdate,
    onDeckDelete: handleDeckDelete,
    onAddTopicConfirm: handleAddTopicConfirm,
    onRemoveTopicConfirm: handleRemoveTopicConfirm,
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
      resetForm();
      setD((prev) => ({ ...prev, createOpen: true }));
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [role, currentDeck?.created_by, user?.id]);

  if (deckError || (!deckLoading && !currentDeck)) {
    return (
      <div className="space-y-6">
        <Breadcrumbs items={parentBreadcrumbs} />
        <div className="flex flex-col items-center justify-center py-24 text-muted-foreground">
          <p className="text-lg">Deck not found</p>
        </div>
      </div>
    );
  }

  if (deckLoading) {
    return <DeckDetailSkeleton />;
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs items={[
        ...parentBreadcrumbs,
        { label: currentDeck?.name ?? '', href: '#' },
      ]} />

      <div className={`relative group rounded-xl bg-gradient-to-br ${gradient} p-8 text-white`}>
        <div className="absolute right-4 top-4 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20"
              onClick={() => setD((prev) => ({ ...prev, deckEditOpen: true, deckFormData: { name: currentDeck?.name ?? '', description: currentDeck?.description ?? '' } }))}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can(role, 'deck.delete', currentDeck?.created_by, user?.id) && (
            <Button
              variant="ghost" size="icon" className="h-8 w-8 text-white/80 hover:text-red-200 hover:bg-white/20"
              onClick={() => setD((prev) => ({ ...prev, deckDeleteOpen: true }))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          )}
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
                <Button
                  variant="secondary" size="sm" className="bg-white/20 text-white hover:bg-white/30 gap-1"
                  onClick={() => router.push(`${practiceHref}${currentDeck!.id}`)}
                >
                  <Play className="h-3 w-3" /> {t('practice_deck')}
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
          {isSelecting && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const allSelected = flashcards.every(fc => selectedIds.has(fc.id));
                if (allSelected) {
                  setSelectedIds(new Set());
                } else {
                  setSelectedIds(new Set(flashcards.map(fc => fc.id)));
                }
              }}
            >
              <CheckCheck className="mr-2 h-4 w-4" />
              {flashcards.every(fc => selectedIds.has(fc.id)) ? t('deselect_all') : t('select_all')}
            </Button>
          )}
          <Button
            variant={isSelecting ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => {
              if (isSelecting) clearSelection();
              else setIsSelecting(true);
            }}
          >
            {isSelecting ? <Square className="mr-2 h-4 w-4" /> : <CheckSquare className="mr-2 h-4 w-4" />}
            {isSelecting ? t('cancel_selection') : t('select_cards')}
          </Button>
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <Button onClick={() => {
              resetForm();
              setD((prev) => ({ ...prev, createOpen: true }));
            }} aria-keyshortcuts="n">
              <Plus className="mr-2 h-4 w-4" /> {t('new_flashcard')}
            </Button>
          )}
        </div>
      </div>

      {flashcards.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">{t('no_flashcards')}</p>
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <Button variant="outline" className="mt-4" onClick={() => {
              resetForm();
              setD((prev) => ({ ...prev, createOpen: true }));
            }} aria-keyshortcuts="n">
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
              onRemoveTopic={(fc) => setD((prev) => ({ ...prev, activeFlashcardId: fc.id, topicActionIds: [], removeTopicOpen: true }))}
              onViewByTopic={(_fc, topicId) => setD((prev) => ({ ...prev, viewTopicId: topicId }))}
            />
          ))}
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
            onDelete={() => setD((prev) => ({ ...prev, bulkDeleteOpen: true, selectedIds: Array.from(selectedIds) }))}
            onLink={() => setD((prev) => ({ ...prev, bulkLinkOpen: true, bulkLinkDeckIds: [], selectedIds: Array.from(selectedIds) }))}
            onTopics={() => setD((prev) => ({ ...prev, bulkTopicsOpen: true, bulkTopicIds: [], bulkTopicsOperation: 'set', selectedIds: Array.from(selectedIds) }))}
            onCopy={() => setD((prev) => ({ ...prev, bulkCopyOpen: true, bulkCopyTargetDeckId: null, selectedIds: Array.from(selectedIds) }))}
            onMove={() => setD((prev) => ({ ...prev, bulkMoveOpen: true, bulkMoveTargetDeckId: null, selectedIds: Array.from(selectedIds) }))}
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
    </div>
  );
}
