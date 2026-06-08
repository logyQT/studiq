'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
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
import { ArrowLeft, Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
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

function getGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface DecksClientProps {
  decks: Deck[];
}

export default function DecksClient({ decks: initialDecks }: DecksClientProps) {
  const t = useTranslations('AppFlashcardDecksPage');
  const router = useRouter();
  const [decks, setDecks] = useState<Deck[]>(initialDecks);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deck | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '', description: '' });

  function resetForm() {
    setFormData({ name: '', description: '' });
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
    });
    setDialogOpen(true);
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
        setDecks([{ ...result, flashcard_count: 0 }, ...decks]);
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
        {decks.map((deck) => {
          const gradient = getGradient(deck.id);
          return (
            <Card
              key={deck.id}
              className="group overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50"
              onClick={() => router.push(`/app/flashcards/deck/${deck.id}`)}
            >
              <div className={`h-20 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                <span className="text-2xl font-bold text-white/90">{deck.name.charAt(0).toUpperCase()}</span>
              </div>
              <CardHeader className="pb-2">
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
                      onClick={(e) => { e.stopPropagation(); openEdit(deck); }}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label="Delete"
                      onClick={(e) => { e.stopPropagation(); setDeleteId(deck.id); }}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0">
                <Badge variant="secondary">{t('flashcards_count', { count: deck.flashcard_count })}</Badge>
                <Button variant="ghost" size="sm" className="gap-1" onClick={(e) => { e.stopPropagation(); router.push(`/app/flashcards/deck/${deck.id}`); }}>
                  {t('open_deck')} <ArrowRight className="h-3 w-3" />
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {decks.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            {t('no_decks')}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
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
              className="bg-destructive text-white"
            >
              {t('common_delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
