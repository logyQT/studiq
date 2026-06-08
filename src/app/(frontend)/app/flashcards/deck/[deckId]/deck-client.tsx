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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
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
  Check,
  X,
  ExternalLink,
} from 'lucide-react';
import { toast } from 'sonner';

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

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  flashcard_deck_assignments?: Array<{ deck_id: string }>;
}

interface DeckClientProps {
  deck: Deck;
  flashcards: Flashcard[];
  topics: Topic[];
  allDecks: Deck[];
}

export default function DeckClient({ deck, flashcards: initialFlashcards, topics, allDecks }: DeckClientProps) {
  const t = useTranslations('AppFlashcardDeckViewPage');
  const router = useRouter();
  const gradient = getGradient(deck.id);

  const [flashcards, setFlashcards] = useState<Flashcard[]>(initialFlashcards);
  const [currentDeck, setCurrentDeck] = useState<Deck>(deck);
  const [flippedId, setFlippedId] = useState<string | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copyResult, setCopyResult] = useState<{ id: string; deckId: string } | null>(null);
  const [topicMenuOpen, setTopicMenuOpen] = useState(false);
  const [activeFlashcardId, setActiveFlashcardId] = useState<string | null>(null);

  const [formData, setFormData] = useState({ front: '', back: '', topicIds: [] as string[] });
  const [linkDeckIds, setLinkDeckIds] = useState<string[]>([]);
  const [copyTargetDeckId, setCopyTargetDeckId] = useState<string | null>(null);

  const [deckEditOpen, setDeckEditOpen] = useState(false);
  const [deckDeleteOpen, setDeckDeleteOpen] = useState(false);
  const [deckFormData, setDeckFormData] = useState({ name: currentDeck.name, description: currentDeck.description || '' });

  const getTopicIds = useCallback(
    (fc: Flashcard) => fc.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [],
    [],
  );

  const getTopicNames = useCallback(
    (fc: Flashcard) => {
      const ids = getTopicIds(fc);
      return topics.filter((topic) => ids.includes(topic.id));
    },
    [topics, getTopicIds],
  );

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
      const res = await fetch('/api/v1/flashcards', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deckId: deck.id,
          front: formData.front,
          back: formData.back,
          topicIds: formData.topicIds.length > 0 ? formData.topicIds : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setFlashcards([body.data, ...flashcards]);
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
      const res = await fetch(`/api/v1/flashcards/${activeFlashcardId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          front: formData.front,
          back: formData.back,
          topicIds: formData.topicIds,
        }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      setFlashcards(flashcards.map((fc) => (fc.id === activeFlashcardId ? body.data : fc)));
      setEditOpen(false);
      resetForm();
      toast.success(t('flashcard_updated'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    const prevFlashcards = [...flashcards];
    setFlashcards(flashcards.filter((fc) => fc.id !== deleteId));
    try {
      const res = await fetch(`/api/v1/flashcards/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(t('flashcard_deleted'));
    } catch {
      setFlashcards(prevFlashcards);
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  async function handleLink() {
    if (!activeFlashcardId || linkDeckIds.length === 0) return;
    try {
      const res = await fetch(`/api/v1/flashcards/${activeFlashcardId}/link`, {
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
      const res = await fetch(`/api/v1/flashcards/${activeFlashcardId}/copy`, {
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
    setDeckFormData({ name: currentDeck.name, description: currentDeck.description || '' });
    setDeckEditOpen(true);
  }

  async function handleDeckUpdate() {
    if (!deckFormData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    const prevDeck = { ...currentDeck };
    const updatedDeck = { ...currentDeck, name: deckFormData.name, description: deckFormData.description || null };
    setCurrentDeck(updatedDeck);
    setDeckEditOpen(false);
    try {
      const res = await fetch(`/api/v1/flashcards/decks/${currentDeck.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: deckFormData.name, description: deckFormData.description || undefined }),
      });
      if (!res.ok) throw new Error();
      toast.success(t('deck_updated'));
    } catch {
      setCurrentDeck(prevDeck);
      toast.error(t('save_failed'));
    }
  }

  async function handleDeckDelete() {
    const prevDeck = { ...currentDeck };
    setCurrentDeck({ ...currentDeck, name: '[DELETED]' });
    try {
      const res = await fetch(`/api/v1/flashcards/decks/${currentDeck.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      toast.success(t('deck_deleted'));
      router.push('/app/flashcards/decks');
    } catch {
      setCurrentDeck(prevDeck);
      toast.error(t('delete_failed'));
    }
    setDeckDeleteOpen(false);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/app/flashcards/decks">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
      </div>

      <div className={`relative group rounded-xl bg-gradient-to-br ${gradient} p-8 text-white`}>
        <div className="absolute right-4 top-4 flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/80 hover:text-white hover:bg-white/20"
            onClick={openDeckEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-white/80 hover:text-red-200 hover:bg-white/20"
            onClick={() => setDeckDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex items-start gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-white/20 text-2xl font-bold">
            {currentDeck.name.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1">
            <h2 className="text-2xl font-bold">{currentDeck.name}</h2>
            {currentDeck.description && <p className="mt-1 text-white/80">{currentDeck.description}</p>}
            <div className="mt-3 flex items-center gap-4">
              <Badge variant="secondary" className="bg-white/20 text-white">
                {t('flashcards_count', { count: flashcards.length })}
              </Badge>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{t('flashcards_section')}</h3>
          <p className="text-sm text-muted-foreground">{t('flip_hint')}</p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('new_flashcard')}
        </Button>
      </div>

      {flashcards.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground">{t('no_flashcards')}</p>
          <Button variant="outline" className="mt-4" onClick={openCreate}>
            <Plus className="mr-2 h-4 w-4" /> {t('create_first')}
          </Button>
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
                      <DropdownMenuItem onClick={(e) => { e.stopPropagation(); openEdit(fc); }}>
                        <Pencil className="mr-2 h-4 w-4" /> {t('menu_edit')}
                      </DropdownMenuItem>
                      <DropdownMenuSub>
                        <DropdownMenuSubTrigger>
                          <Tags className="mr-2 h-4 w-4" /> {t('menu_topics')}
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                          {topics.map((topic) => (
                            <DropdownMenuItem
                              key={topic.id}
                              onClick={(e) => e.stopPropagation()}
                              className="gap-2"
                            >
                              <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                              {topic.name}
                            </DropdownMenuItem>
                          ))}
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
                      <DropdownMenuItem
                        className="text-destructive"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteId(fc.id);
                        }}
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> {t('menu_delete')}
                      </DropdownMenuItem>
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
            <Button onClick={() => { router.push(`/app/flashcards/deck/${copyResult?.deckId}`); setCopyResult(null); }}>
              <ExternalLink className="mr-2 h-4 w-4" /> {t('copy_go_to_card')}
            </Button>
            <Button variant="outline" onClick={() => setCopyResult(null)}>
              {t('copy_stay_here')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete_dialog_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-white">
              {t('common_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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

      <AlertDialog open={deckDeleteOpen} onOpenChange={setDeckDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('deck_delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('deck_delete_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDeckDelete} className="bg-destructive text-white">
              {t('common_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
