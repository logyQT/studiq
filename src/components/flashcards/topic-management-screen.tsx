'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ArrowLeft, Plus, Trash2, Eye, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { DeleteConfirmDialog } from '@/components/flashcards/delete-confirm-dialog';

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

function getTopicColor(name: string) {
  return TOPIC_COLORS[name.length % TOPIC_COLORS.length];
}

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface Flashcard {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments?: Array<{ topic_id: string }>;
  created_at?: string;
}

interface TopicManagementScreenProps {
  topics: Topic[];
  flashcards: Flashcard[];
  backHref: string;
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
}

export function TopicManagementScreen({ topics: initialTopics, flashcards: initialFlashcards, backHref, apiBase, t }: TopicManagementScreenProps) {
  const [topics, setTopics] = useState<Topic[]>(initialTopics);
  const [flashcards, setFlashcards] = useState<Flashcard[]>(initialFlashcards);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '' });

  function resetForm() {
    setFormData({ name: '' });
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(topic: Topic) {
    setEditing(topic);
    setFormData({ name: topic.name });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    try {
      const url = editing ? `${apiBase}/topics/${editing.id}` : `${apiBase}/topics`;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      const result = body.data ?? body;
      if (editing) {
        setTopics(topics.map((tp) => (tp.id === result.id ? result : tp)));
      } else {
        setTopics([{ ...result, flashcard_count: 0 }, ...topics]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? t('topic_updated') : t('topic_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`${apiBase}/topics/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setTopics(topics.filter((tp) => tp.id !== deleteId));
      toast.success(t('topic_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  const viewFlashcards = viewTopicId
    ? flashcards.filter((fc) =>
        fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
      )
    : [];

  const viewTopic = topics.find((tp) => tp.id === viewTopicId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href={backHref}>
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
            </Button>
          </Link>
          <h2 className="text-2xl font-bold">{t('title')}</h2>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('new_topic')}
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {topics.map((topic) => {
          const color = getTopicColor(topic.name);
          return (
            <Card key={topic.id} className="group">
              <CardContent className="p-5">
                <div className="flex items-start justify-between">
                  <div className={`h-10 w-10 rounded-lg ${color} flex items-center justify-center`}>
                    <span className="text-sm font-bold text-white">{topic.name.charAt(0).toUpperCase()}</span>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t('view_flashcards')}
                      onClick={() => setViewTopicId(topic.id)}
                    >
                      <Eye className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t('common_edit')}
                      onClick={() => openEdit(topic)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      aria-label={t('common_delete')}
                      onClick={() => setDeleteId(topic.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                </div>
                <h3 className="mt-3 font-semibold truncate">{topic.name}</h3>
                <Badge variant="secondary" className="mt-2">
                  {t('flashcards_count', { count: topic.flashcard_count })}
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-3"
                  onClick={() => setViewTopicId(topic.id)}
                >
                  {t('browse_flashcards')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {topics.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            {t('no_topics')}
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('new_topic_title')}</DialogTitle>
            <DialogDescription>{editing ? t('edit_desc') : t('new_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="topic-name">{t('topic_name_label')}</Label>
            <Input
              id="topic-name"
              value={formData.name}
              onChange={(e) => setFormData({ name: e.target.value })}
              placeholder={t('topic_name_placeholder')}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDialogOpen(false); resetForm(); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleSubmit}>{editing ? t('common_update') : t('common_create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
              {t('view_flashcards_count', { count: viewFlashcards.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {viewFlashcards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">{t('no_flashcards_for_topic')}</p>
            ) : (
              viewFlashcards.map((fc) => (
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

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
      />
    </div>
  );
}
