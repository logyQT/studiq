'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { DeleteConfirmDialog } from '@/components/flashcards/delete-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ArrowLeft,
  Plus,
  MoreVertical,
  Pencil,
  Trash2,
  Link2,
  Copy,
  Tags,
  X,
  ExternalLink,
  Play,
} from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import type { Deck, Flashcard, Topic } from '@/types/flashcards';
import { useDeckFlashcardRealtime, useTopicRealtime } from '@/hooks/use-flashcard-realtime';
import { useAuth } from '@/components/providers/AuthProvider';
import { can } from '@/lib/frontend-rbac';
import { UserRole } from '@/types';

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
  'from-red-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500',
  'from-teal-500 to-emerald-600',
];

const TOPIC_COLORS = [
  'bg-red-500',
  'bg-blue-500',
  'bg-green-500',
  'bg-yellow-500',
  'bg-purple-500',
  'bg-pink-500',
  'bg-indigo-500',
  'bg-teal-500',
  'bg-orange-500',
  'bg-cyan-500',
];

function getGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

function getTopicColor(name: string) {
  return TOPIC_COLORS[name.length % TOPIC_COLORS.length];
}

interface DeckDetailScreenProps {
  deckId: string;
  backHref: string;
  basePath: string;
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
  practiceHref?: string;
}

export function DeckDetailScreen({ deckId, backHref, basePath, apiBase, t, practiceHref }: DeckDetailScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.app_metadata?.role as UserRole | undefined;
  const gradient = getGradient(deckId);

  useDeckFlashcardRealtime(deckId);
  useTopicRealtime();

  const { data: currentDeckData, isLoading: deckLoading, isError: deckError } = useApiQuery<Deck>({ queryKey: flashcardKeys.decks.detail(deckId), url: `/api/v1/flashcards/decks/${deckId}`, enabled: !!deckId });
  const { data: flashcardsData } = useApiQuery<Flashcard[]>({ queryKey: flashcardKeys.list({ deckIds: [deckId] }), url: `/api/v1/flashcards?deckIds=${deckId}`, enabled: !!deckId });
  const { data: topicsData } = useApiQuery<Topic[]>({ queryKey: flashcardKeys.topics.all, url: '/api/v1/flashcards/topics' });
  const { data: allDecksData } = useApiQuery<Deck[]>({ queryKey: flashcardKeys.decks.all, url: '/api/v1/flashcards/decks' });

  const flashcards = flashcardsData ?? [];
  const currentDeck = currentDeckData ?? null;
  const topics = topicsData ?? [];
  const allDecks = (allDecksData ?? []).filter((d) => d.id !== deckId);

  const flashcardQueryKey = flashcardKeys.list({ deckIds: [deckId] });

  const createFlashcard = useApiMutation({ mutationFn: (data: { front: string; back: string; topicIds?: string[] }) => apiPost<Flashcard>('/api/v1/flashcards', { ...data, deckId }), invalidateKeys: [flashcardQueryKey] });
  const updateFlashcard = useApiMutation({ mutationFn: ({ id, ...data }: { id: string; front: string; back: string; topicIds: string[] }) => apiPut<Flashcard>(`/api/v1/flashcards/${id}`, data), invalidateKeys: [flashcardQueryKey], onMutate: async ({ id, ...data }) => { await queryClient.cancelQueries({ queryKey: flashcardQueryKey }); const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey); queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) => old?.map((fc) => fc.id === id ? { ...fc, ...data } : fc)); return { previous: prev }; }, onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); } });
  const deleteFlashcard = useApiMutation({ mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/${id}`), invalidateKeys: [flashcardQueryKey], onMutate: async (id) => { await queryClient.cancelQueries({ queryKey: flashcardQueryKey }); const prev = queryClient.getQueryData<Flashcard[]>(flashcardQueryKey); queryClient.setQueryData<Flashcard[]>(flashcardQueryKey, (old) => old?.filter((fc) => fc.id !== id)); return { previous: prev }; }, onError: (_err, _id, ctx) => { queryClient.setQueryData(flashcardQueryKey, ctx?.previous); } });
  const updateDeck = useApiMutation({ mutationFn: ({ id, ...data }: { id: string; name: string; description?: string }) => apiPut<Deck>(`/api/v1/flashcards/decks/${id}`, data), invalidateKeys: [flashcardKeys.decks.all], onMutate: async ({ id, ...data }) => { await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all }); const prev = queryClient.getQueryData<Deck[]>(flashcardKeys.decks.all); queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) => old?.map((d) => d.id === id ? { ...d, ...data } : d)); return { previous: prev }; }, onError: (_err, _vars, ctx) => { queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous); } });
  const deleteDeck = useApiMutation({ mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/decks/${id}`), invalidateKeys: [flashcardKeys.decks.all], onMutate: async (id) => { await queryClient.cancelQueries({ queryKey: flashcardKeys.decks.all }); const prev = queryClient.getQueryData<Deck[]>(flashcardKeys.decks.all); queryClient.setQueryData<Deck[]>(flashcardKeys.decks.all, (old) => old?.filter((d) => d.id !== id)); return { previous: prev }; }, onError: (_err, _id, ctx) => { queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous); } });

  const [flippedId, setFlippedId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyResult, setCopyResult] = useState<{ id: string; deckId: string } | null>(null);
  const [activeFlashcardId, setActiveFlashcardId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ front: '', back: '', topicIds: [] as string[] });
  const [linkDeckIds, setLinkDeckIds] = useState<string[]>([]);
  const [copyTargetDeckId, setCopyTargetDeckId] = useState<string | null>(null);

  const [deckEditOpen, setDeckEditOpen] = useState(false);
  const [deckDeleteOpen, setDeckDeleteOpen] = useState(false);
  const [deckFormData, setDeckFormData] = useState({ name: '', description: '' });

  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [addTopicOpen, setAddTopicOpen] = useState(false);
  const [removeTopicOpen, setRemoveTopicOpen] = useState(false);
  const [topicActionIds, setTopicActionIds] = useState<string[]>([]);

  const getTopicIds = useCallback(
    (fc: Flashcard | undefined) => fc?.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [],
    [],
  );

  const getTopicNames = useCallback(
    (fc: Flashcard) => {
      const ids = getTopicIds(fc);
      return (topics ?? []).filter((topic) => ids.includes(topic.id));
    },
    [topics, getTopicIds],
  );

  const viewTopicFlashcards = viewTopicId
    ? (flashcards ?? []).filter((fc) =>
        fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
      )
    : [];

  const viewTopic = topics?.find((tp) => tp.id === viewTopicId);

  function resetForm() {
    setFormData({ front: '', back: '', topicIds: [] });
  }

  function openCreate() {
    resetForm();
    setCreateOpen(true);
  }

  function openEdit(fc: Flashcard) {
    setFormData({
      front: fc.front,
      back: fc.back,
      topicIds: getTopicIds(fc),
    });
    setActiveFlashcardId(fc.id);
    setEditOpen(true);
  }

  function toggleTopic(id: string) {
    setFormData((prev) => ({
      ...prev,
      topicIds: prev.topicIds.includes(id)
        ? prev.topicIds.filter((tid) => tid !== id)
        : [...prev.topicIds, id],
    }));
  }

  async function handleCreate() {
    if (!formData.front.trim() || !formData.back.trim()) {
      toast.error(t('front_back_required'));
      return;
    }
    try {
      await createFlashcard.mutateAsync({
        front: formData.front,
        back: formData.back,
        topicIds: formData.topicIds.length > 0 ? formData.topicIds : undefined,
      });
      setCreateOpen(false);
      resetForm();
      toast.success(t('flashcard_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleUpdate() {
    if (!activeFlashcardId) return;
    if (!formData.front.trim() || !formData.back.trim()) {
      toast.error(t('front_back_required'));
      return;
    }
    try {
      await updateFlashcard.mutateAsync({
        id: activeFlashcardId,
        front: formData.front,
        back: formData.back,
        topicIds: formData.topicIds,
      });
      setEditOpen(false);
      resetForm();
      toast.success(t('flashcard_updated'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteFlashcard.mutateAsync(deleteId);
      toast.success(t('flashcard_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  async function handleLink() {
    if (!activeFlashcardId || linkDeckIds.length === 0) return;
    try {
      const res = await fetch(`${apiBase}/${activeFlashcardId}/link`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deckIds: linkDeckIds }),
      });
      if (!res.ok) throw new Error();
      setLinkOpen(false);
      setLinkDeckIds([]);
      toast.success(t('flashcard_linked'));
    } catch {
      toast.error(t('link_failed'));
    }
  }

  async function handleCopy() {
    if (!activeFlashcardId || !copyTargetDeckId) return;
    try {
      const res = await fetch(`${apiBase}/${activeFlashcardId}/copy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetDeckId: copyTargetDeckId }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setCopyOpen(false);
      setCopyResult({ id: body.data.id, deckId: copyTargetDeckId });
      toast.success(t('flashcard_copied'));
    } catch {
      toast.error(t('copy_failed'));
    }
  }

  function openDeckEdit() {
    setDeckFormData({ name: currentDeck?.name ?? '', description: currentDeck?.description ?? '' });
    setDeckEditOpen(true);
  }

  async function handleDeckUpdate() {
    if (!deckFormData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    setDeckEditOpen(false);
    try {
      await updateDeck.mutateAsync({
        id: deckId,
        name: deckFormData.name,
        description: deckFormData.description || undefined,
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
      router.push(backHref);
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeckDeleteOpen(false);
  }

  if (deckError || (!deckLoading && !currentDeck)) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link href={backHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
            </Button>
          </Link>
        </div>
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
      <div className="flex items-center gap-4">
        <Link href={backHref}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
      </div>

      <div className={`relative group rounded-xl bg-gradient-to-br ${gradient} p-8 text-white`}>
        <div className="absolute right-4 top-4 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20"
              onClick={openDeckEdit}
            >
              <Pencil className="h-4 w-4" />
            </Button>
          )}
          {can(role, 'deck.delete', currentDeck?.created_by, user?.id) && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/80 hover:text-red-200 hover:bg-white/20"
              onClick={() => setDeckDeleteOpen(true)}
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
            {currentDeck!.description && <p className="mt-1 text-white/80">{currentDeck!.description}</p>}
            <div className="mt-3 flex items-center gap-4">
              <Badge variant="secondary" className="bg-white/20 text-white">
                {t('flashcards_count', { count: flashcards.length })}
              </Badge>
              {practiceHref && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="bg-white/20 text-white hover:bg-white/30 gap-1"
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
        {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
          <Button onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> {t('new_flashcard')}
          </Button>
        )}
      </div>

      {flashcards.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">{t('no_flashcards')}</p>
          {can(role, 'deck.update', currentDeck?.created_by, user?.id) && (
            <Button variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="mr-2 h-4 w-4" /> {t('create_first')}
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {flashcards.map((fc) => {
            const isFlipped = flippedId === fc.id;
            const fcTopics = getTopicNames(fc);
            return (
              <Card
                key={fc.id}
                className={`group relative min-h-48 cursor-pointer transition-all duration-300 hover:shadow-lg ${
                  isFlipped ? `bg-gradient-to-br ${gradient}` : ''
                }`}
                onClick={() => setFlippedId(isFlipped ? null : fc.id)}
              >
                <div className="absolute right-2 top-2 z-10 opacity-0 transition-opacity group-hover:opacity-100">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="secondary" size="icon" className="h-7 w-7" onClick={(e) => e.stopPropagation()}>
                        <MoreVertical className="h-3 w-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {can(role, 'flashcard.update', fc.created_by, user?.id) && (
                        <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(fc); }}>
                          <Pencil className="mr-2 h-4 w-4" /> {t('menu_edit')}
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Tags className="mr-2 h-4 w-4" /> {t('menu_topics')}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setTopicActionIds([]);
                              setAddTopicOpen(true);
                            }}
                          >
                            <Plus className="mr-2 h-4 w-4" /> {t('menu_add_topic')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              setTopicActionIds([]);
                              setRemoveTopicOpen(true);
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> {t('menu_remove_topic')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            onClick={(e) => {
                              e.stopPropagation();
                              const assignedIds = getTopicIds(fc);
                              const firstAssigned = topics.find((tp) => assignedIds.includes(tp.id));
                              if (firstAssigned) setViewTopicId(firstAssigned.id);
                            }}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" /> {t('menu_view_by_topic')}
                          </DropdownMenuItem>
                        </DropdownMenuSubContent>
                      </DropdownMenuSub>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFlashcardId(fc.id);
                          setLinkDeckIds([]);
                          setLinkOpen(true);
                        }}
                      >
                        <Link2 className="mr-2 h-4 w-4" /> {t('menu_link')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveFlashcardId(fc.id);
                          setCopyTargetDeckId(null);
                          setCopyOpen(true);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" /> {t('menu_copy')}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      {can(role, 'flashcard.delete', fc.created_by, user?.id) && (
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteId(fc.id);
                          }}
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> {t('menu_delete')}
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>

                <CardContent className="flex flex-col items-center justify-center p-6 pt-8">
                  <p className="mb-2 text-xs uppercase text-muted-foreground">
                    {isFlipped ? t('answer_label') : t('question_label')}
                  </p>
                  <p className={`text-center text-lg font-medium ${isFlipped ? 'text-white' : ''}`}>
                    {isFlipped ? fc.back : fc.front}
                  </p>
                  <div className="mt-auto pt-4 w-full">
                    {fcTopics.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {fcTopics.map((topic) => (
                          <Badge key={topic.id} variant="secondary" className="gap-1 text-xs">
                            <div className={`h-1.5 w-1.5 rounded-full ${getTopicColor(topic.name)}`} />
                            {topic.name}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('no_topics')}</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('create_title')}</DialogTitle>
            <DialogDescription>{t('create_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('front_label')}</Label>
              <Textarea
                value={formData.front}
                onChange={(e) => setFormData({ ...formData, front: e.target.value })}
                placeholder={t('front_placeholder')}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('back_label')}</Label>
              <Textarea
                value={formData.back}
                onChange={(e) => setFormData({ ...formData, back: e.target.value })}
                placeholder={t('back_placeholder')}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('topics_label')}</Label>
              <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                {topics.map((topic) => (
                  <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={formData.topicIds.includes(topic.id)}
                      onCheckedChange={() => toggleTopic(topic.id)}
                    />
                    <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                    <span className="text-sm">{topic.name}</span>
                  </div>
                ))}
                {topics.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('no_topics_available')}</p>
                )}
              </div>
              {formData.topicIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 p-2 rounded-lg bg-muted">
                  {formData.topicIds.map((id) => {
                    const topic = topics.find((t) => t.id === id);
                    if (!topic) return null;
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        <div className={`h-1.5 w-1.5 rounded-full ${getTopicColor(topic.name)}`} />
                        {topic.name}
                        <button
                          className="ml-1 hover:text-destructive"
                          onClick={() => toggleTopic(id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCreateOpen(false); resetForm(); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleCreate}>{t('common_create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('edit_title')}</DialogTitle>
            <DialogDescription>{t('edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('front_label')}</Label>
              <Textarea
                value={formData.front}
                onChange={(e) => setFormData({ ...formData, front: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('back_label')}</Label>
              <Textarea
                value={formData.back}
                onChange={(e) => setFormData({ ...formData, back: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('topics_label')}</Label>
              <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                {topics.map((topic) => (
                  <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={formData.topicIds.includes(topic.id)}
                      onCheckedChange={() => toggleTopic(topic.id)}
                    />
                    <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                    <span className="text-sm">{topic.name}</span>
                  </div>
                ))}
              </div>
              {formData.topicIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 p-2 rounded-lg bg-muted">
                  {formData.topicIds.map((id) => {
                    const topic = topics.find((t) => t.id === id);
                    if (!topic) return null;
                    return (
                      <Badge key={id} variant="secondary" className="gap-1">
                        <div className={`h-1.5 w-1.5 rounded-full ${getTopicColor(topic.name)}`} />
                        {topic.name}
                        <button
                          className="ml-1 hover:text-destructive"
                          onClick={() => toggleTopic(id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </Badge>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setEditOpen(false); resetForm(); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleUpdate}>{t('common_update')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('link_title')}</DialogTitle>
            <DialogDescription>{t('link_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {allDecks.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  checked={linkDeckIds.includes(d.id)}
                  onCheckedChange={() =>
                    setLinkDeckIds((prev) =>
                      prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id],
                    )
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && <p className="text-xs text-muted-foreground truncate">{d.description}</p>}
                </div>
              </div>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t('no_other_decks')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setLinkOpen(false); setLinkDeckIds([]); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleLink} disabled={linkDeckIds.length === 0}>
              {t('link_button', { count: linkDeckIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={copyOpen} onOpenChange={setCopyOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('copy_title')}</DialogTitle>
            <DialogDescription>{t('copy_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {allDecks.map((d) => (
              <button
                key={d.id}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  copyTargetDeckId === d.id
                    ? 'border-primary bg-primary/5'
                    : 'hover:bg-muted'
                }`}
                onClick={() => setCopyTargetDeckId(d.id)}
              >
                <div
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                    copyTargetDeckId === d.id ? 'border-primary' : 'border-muted-foreground'
                  }`}
                >
                  {copyTargetDeckId === d.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && <p className="text-xs text-muted-foreground truncate">{d.description}</p>}
                </div>
                <Badge variant="secondary">{t('flashcards_count', { count: d.flashcard_count })}</Badge>
              </button>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">{t('no_other_decks')}</p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setCopyOpen(false); setCopyTargetDeckId(null); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleCopy} disabled={!copyTargetDeckId}>
              {t('copy_button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!copyResult} onOpenChange={(open) => { if (!open) setCopyResult(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('copy_success_title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button onClick={() => { router.push(`${basePath}/deck/${copyResult?.deckId}`); setCopyResult(null); }}>
              <ExternalLink className="mr-2 h-4 w-4" /> {t('copy_go_to_card')}
            </Button>
            <Button variant="outline" onClick={() => setCopyResult(null)}>
              {t('copy_stay_here')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
      />

      <Dialog open={deckEditOpen} onOpenChange={setDeckEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deck_edit_title')}</DialogTitle>
            <DialogDescription>{t('deck_edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('deck_name_label')}</Label>
              <Input
                value={deckFormData.name}
                onChange={(e) => setDeckFormData({ ...deckFormData, name: e.target.value })}
                placeholder={t('deck_name_placeholder')}
              />
            </div>
            <div>
              <Label>{t('deck_description_label')}</Label>
              <Textarea
                value={deckFormData.description}
                onChange={(e) => setDeckFormData({ ...deckFormData, description: e.target.value })}
                placeholder={t('deck_description_placeholder')}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeckEditOpen(false)}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleDeckUpdate}>{t('common_update')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={deckDeleteOpen}
        onOpenChange={setDeckDeleteOpen}
        onConfirm={handleDeckDelete}
        title={t('deck_delete_title')}
        description={t('deck_delete_desc')}
      />

      <Dialog open={!!viewTopicId} onOpenChange={(open) => { if (!open) setViewTopicId(null); }}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewTopic && (
                <span className="flex items-center gap-2">
                  <div className={`h-5 w-5 rounded ${getTopicColor(viewTopic.name)}`} />
                  {viewTopic.name}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {t('view_flashcards_for_topic', { count: viewTopicFlashcards.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {viewTopicFlashcards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t('no_flashcards_for_topic')}</p>
            ) : (
              viewTopicFlashcards.map((fc) => (
                <div key={fc.id} className="p-4 rounded-lg border space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">{t('question_label')}</p>
                    <p className="text-sm font-medium">{fc.front}</p>
                  </div>
                  <div className="border-t pt-2">
                    <p className="text-xs text-muted-foreground uppercase">{t('answer_label')}</p>
                    <p className="text-sm">{fc.back}</p>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setViewTopicId(null)}>{t('common_close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={addTopicOpen} onOpenChange={setAddTopicOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('menu_add_topic')}</DialogTitle>
            <DialogDescription>{t('add_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {(() => {
              const assignedIds = getTopicIds(flashcards.find((f) => f.id === activeFlashcardId));
              const available = topics.filter((topic) => !assignedIds.includes(topic.id));
              return (
                <>
                  {available.map((topic) => (
                    <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                      <Checkbox
                        checked={topicActionIds.includes(topic.id)}
                        onCheckedChange={() =>
                          setTopicActionIds((prev) =>
                            prev.includes(topic.id) ? prev.filter((id) => id !== topic.id) : [...prev, topic.id],
                          )
                        }
                      />
                      <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                      <span className="text-sm">{topic.name}</span>
                    </div>
                  ))}
                  {available.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('no_other_topics_to_add')}</p>
                  )}
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAddTopicOpen(false)}>{t('common_cancel')}</Button>
              <Button
                onClick={async () => {
                  if (!activeFlashcardId || topicActionIds.length === 0) return;
                  const fc = flashcards?.find((f) => f.id === activeFlashcardId);
                  if (!fc) return;
                  const currentIds = getTopicIds(fc);
                  const newIds = [...new Set([...currentIds, ...topicActionIds])];
                  try {
                    await updateFlashcard.mutateAsync({
                      id: activeFlashcardId,
                      front: fc.front,
                      back: fc.back,
                      topicIds: newIds,
                    });
                    toast.success(t('topic_added'));
                  } catch {
                    toast.error(t('save_failed'));
                  }
                  setAddTopicOpen(false);
                  setTopicActionIds([]);
                }}
                disabled={topicActionIds.length === 0}
              >
                {t('common_add')}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={removeTopicOpen} onOpenChange={setRemoveTopicOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('menu_remove_topic')}</DialogTitle>
            <DialogDescription>{t('remove_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {(() => {
              const assignedIds = getTopicIds(flashcards.find((f) => f.id === activeFlashcardId));
              const assigned = topics.filter((topic) => assignedIds.includes(topic.id));
              return (
                <>
                  {assigned.map((topic) => (
                    <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                      <Checkbox
                        checked={topicActionIds.includes(topic.id)}
                        onCheckedChange={() =>
                          setTopicActionIds((prev) =>
                            prev.includes(topic.id) ? prev.filter((id) => id !== topic.id) : [...prev, topic.id],
                          )
                        }
                      />
                      <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                      <span className="text-sm">{topic.name}</span>
                    </div>
                  ))}
                  {assigned.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('no_topics_to_remove')}</p>
                  )}
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRemoveTopicOpen(false)}>{t('common_cancel')}</Button>
              <Button
                onClick={async () => {
                  if (!activeFlashcardId || topicActionIds.length === 0) return;
                  const fc = flashcards?.find((f) => f.id === activeFlashcardId);
                  if (!fc) return;
                  const currentIds = getTopicIds(fc);
                  const newIds = currentIds.filter((id) => !topicActionIds.includes(id));
                  try {
                    await updateFlashcard.mutateAsync({
                      id: activeFlashcardId,
                      front: fc.front,
                      back: fc.back,
                      topicIds: newIds,
                    });
                    toast.success(t('topic_removed'));
                  } catch {
                    toast.error(t('save_failed'));
                  }
                  setRemoveTopicOpen(false);
                  setTopicActionIds([]);
                }}
                disabled={topicActionIds.length === 0}
              >
                {t('common_remove')}
              </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
