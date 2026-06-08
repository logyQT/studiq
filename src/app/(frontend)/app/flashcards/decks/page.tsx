'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
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
import { ArrowLeft, Plus, Pencil, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
  flashcard_deck_assignments: Array<{ flashcard_id: string }>;
}

export default function FlashcardDecksPage() {
  const t = useTranslations('AppFlashcardDecksPage');
  const [decks, setDecks] = useState<Deck[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deck | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    flashcardIds: [] as string[],
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/flashcards/decks').then(async (r) => {
        if (!r.ok) return [];
        const body = await r.json();
        return body.data ?? [];
      }),
      fetch('/api/v1/flashcards').then(async (r) => {
        if (!r.ok) return [];
        const body = await r.json();
        return body.data ?? [];
      }),
    ])
      .then(([d, f]) => {
        setDecks(d);
        setFlashcards(f);
        setLoading(false);
      })
      .catch(() => {
        setDecks([]);
        setFlashcards([]);
        setLoading(false);
      });
  }, []);

  function resetForm() {
    setFormData({ name: '', description: '', flashcardIds: [] });
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(deck: Deck) {
    setEditing(deck);
    setFormData({
      name: deck.name,
      description: deck.description || '',
      flashcardIds: deck.flashcard_deck_assignments?.map((a) => a.flashcard_id) ?? [],
    });
    setDialogOpen(true);
  }

  function toggleFlashcard(id: string) {
    setFormData((prev) => ({
      ...prev,
      flashcardIds: prev.flashcardIds.includes(id)
        ? prev.flashcardIds.filter((fid) => fid !== id)
        : [...prev.flashcardIds, id],
    }));
  }

  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    try {
      const url = editing ? `/api/v1/flashcards/decks/${editing.id}` : '/api/v1/flashcards/decks';
      const method = editing ? 'PUT' : 'POST';
      const payload = {
        name: formData.name,
        description: formData.description || undefined,
        flashcardIds: formData.flashcardIds.length > 0 ? formData.flashcardIds : undefined,
      };
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      const result = body.data ?? body;
      if (editing) {
        setDecks(decks.map((d) => (d.id === result.id ? result : d)));
      } else {
        setDecks([{ ...result, flashcard_count: formData.flashcardIds.length }, ...decks]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? t('deck_updated') : t('deck_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/v1/flashcards/decks/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setDecks(decks.filter((d) => d.id !== deleteId));
      toast.success(t('deck_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/app/flashcards">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
            </Button>
          </Link>
          <h2 className="text-2xl font-bold">{t('title')}</h2>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('new_deck')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => (
          <Card key={deck.id} className="group">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-lg truncate">{deck.name}</CardTitle>
                  {deck.description && (
                    <CardDescription className="line-clamp-2">{deck.description}</CardDescription>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Edit"
                    onClick={() => openEdit(deck)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Delete"
                    onClick={() => setDeleteId(deck.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="secondary">{t('flashcards_count', { count: deck.flashcard_count })}</Badge>
            </CardContent>
          </Card>
        ))}
        {decks.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            {t('no_decks')}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('new_deck_title')}</DialogTitle>
            <DialogDescription>
              {editing ? t('edit_desc') : t('new_deck_desc')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="deck-name">{t('name_label')}</Label>
              <Input
                id="deck-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder={t('name_placeholder')}
              />
            </div>
            <div>
              <Label htmlFor="deck-description">{t('description_label')}</Label>
              <Textarea
                id="deck-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder={t('description_placeholder')}
                rows={2}
              />
            </div>
            <div>
              <Label>{t('flashcards_label')}</Label>
              <div className="space-y-2 mt-2 max-h-48 overflow-y-auto">
                {flashcards.map((fc) => (
                  <div key={fc.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={formData.flashcardIds.includes(fc.id)}
                      onCheckedChange={() => toggleFlashcard(fc.id)}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{fc.front}</p>
                    </div>
                  </div>
                ))}
                {flashcards.length === 0 && (
                  <p className="text-sm text-muted-foreground">{t('no_flashcards')}</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              {t('common_cancel')}
            </Button>
            <Button onClick={handleSubmit}>{editing ? t('common_update') : t('common_create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('delete_dialog_desc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {t('common_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
