'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Pencil, Trash2, Upload } from 'lucide-react';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  flashcard_topic_assignments: Array<{ topic_id: string }>;
  created_at: string;
}

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

export default function FlashcardsPage() {
  const t = useTranslations('EduFlashcardsPage');
  const dl = useTranslations('DashboardLayout');
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Flashcard | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [bulkText, setBulkText] = useState('');

  const [formData, setFormData] = useState({ front: '', back: '', topicIds: [] as string[] });

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/flashcards').then(async (r) => {
        if (!r.ok) return [];
        const body = await r.json();
        return body.data ?? [];
      }),
      fetch('/api/v1/flashcards/topics').then(async (r) => {
        if (!r.ok) return [];
        const body = await r.json();
        return body.data ?? [];
      }),
    ])
      .then(([f, s]) => {
        setFlashcards(f);
        setTopics(s);
        setLoading(false);
      })
      .catch(() => {
        setFlashcards([]);
        setTopics([]);
        setLoading(false);
      });
  }, []);

  function resetForm() {
    setFormData({ front: '', back: '', topicIds: [] });
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(fc: Flashcard) {
    setEditing(fc);
    setFormData({
      front: fc.front,
      back: fc.back,
      topicIds: fc.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [],
    });
    setDialogOpen(true);
  }

  function toggleTopic(topicId: string) {
    setFormData((prev) => ({
      ...prev,
      topicIds: prev.topicIds.includes(topicId)
        ? prev.topicIds.filter((id) => id !== topicId)
        : [...prev.topicIds, topicId],
    }));
  }

  async function handleSubmit() {
    if (!formData.front.trim() || !formData.back.trim()) {
      toast.error(t('both_required'));
      return;
    }
    const payload = {
      front: formData.front,
      back: formData.back,
      topicIds: formData.topicIds.length > 0 ? formData.topicIds : undefined,
    };
    try {
      const url = editing ? `/api/v1/flashcards/${editing.id}` : '/api/v1/flashcards';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      const result = body.data ?? body;
      if (editing) {
        setFlashcards(flashcards.map((f) => (f.id === result.id ? result : f)));
      } else {
        setFlashcards([result, ...flashcards]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? t('updated') : t('created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleBulkCreate() {
    const lines = bulkText.split('\n').filter((l) => l.trim());
    const cards = lines
      .map((line) => {
        const parts = line.split('|').map((p) => p.trim());
        return { front: parts[0] || '', back: parts[1] || '' };
      })
      .filter((c) => c.front && c.back);

    if (cards.length === 0) {
      toast.error(t('no_valid_cards'));
      return;
    }

    try {
      const res = await fetch('/api/v1/flashcards', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cards,
          topicIds: formData.topicIds.length > 0 ? formData.topicIds : undefined,
        }),
      });
      if (!res.ok) throw new Error();
      const body = await res.json();
      const result = body.data ?? body;
      setFlashcards([...result, ...flashcards]);
      setBulkText('');
      toast.success(`${result.length} ${t('bulk_created')}`);
    } catch {
      toast.error(t('bulk_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/v1/flashcards/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setFlashcards(flashcards.filter((f) => f.id !== deleteId));
      toast.success(t('deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  if (loading) return <div className="flex justify-center py-12">{dl('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('create_flashcard')}
        </Button>
      </div>

      <Tabs defaultValue="grid">
        <TabsList>
          <TabsTrigger value="grid">{t('grid')}</TabsTrigger>
          <TabsTrigger value="bulk">{t('bulk_create')}</TabsTrigger>
        </TabsList>
        <TabsContent value="grid">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {flashcards.map((fc) => (
              <Card key={fc.id} className="group relative">
                <CardContent className="p-6">
                  <div className="absolute top-3 right-3 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => openEdit(fc)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setDeleteId(fc.id)}
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        {t('front')}
                      </p>
                      <p className="mt-1 text-sm font-medium">{fc.front}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase">
                        {t('back')}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{fc.back}</p>
                    </div>
                    {fc.flashcard_topic_assignments &&
                      fc.flashcard_topic_assignments.length > 0 && (
                        <div className="flex flex-wrap gap-1 pt-1">
                          {fc.flashcard_topic_assignments.map((a) => {
                            const topic = topics.find((t) => t.id === a.topic_id);
                            return topic ? (
                              <span
                                key={a.topic_id}
                                className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary"
                              >
                                {topic.name}
                              </span>
                            ) : null;
                          })}
                        </div>
                      )}
                  </div>
                </CardContent>
              </Card>
            ))}
            {flashcards.length === 0 && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                {t('no_flashcards')}
              </div>
            )}
          </div>
        </TabsContent>
        <TabsContent value="bulk">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div>
                <Label>{t('topics_optional_label')}</Label>
                <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                  {topics.map((topic) => (
                    <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                      <Checkbox
                        checked={formData.topicIds.includes(topic.id)}
                        onCheckedChange={() => toggleTopic(topic.id)}
                      />
                      <Label className="cursor-pointer flex-1">{topic.name}</Label>
                    </div>
                  ))}
                  {topics.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      {t('no_topics_yet')}
                    </p>
                  )}
                </div>
              </div>
              <div>
                <Label>{t('paste_label')}</Label>
                <Textarea
                  value={bulkText}
                  onChange={(e) => setBulkText(e.target.value)}
                  placeholder={t('paste_placeholder')}
                  rows={10}
                  className="font-mono text-sm"
                />
                <p className="text-xs text-muted-foreground mt-1">{t('paste_hint')}</p>
              </div>
              <Button onClick={handleBulkCreate}>
                <Upload className="mr-2 h-4 w-4" /> {t('create_all')}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('create_title')}</DialogTitle>
            <DialogDescription>{editing ? t('edit_desc') : t('create_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('topics_optional_label')}</Label>
              <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                {topics.map((topic) => (
                  <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={formData.topicIds.includes(topic.id)}
                      onCheckedChange={() => toggleTopic(topic.id)}
                    />
                    <Label className="cursor-pointer flex-1">{topic.name}</Label>
                  </div>
                ))}
                {topics.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('no_topics_yet')}
                  </p>
                )}
              </div>
            </div>
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
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              {t('cancel')}
            </Button>
            <Button onClick={handleSubmit}>{editing ? t('update') : t('create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('delete_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('delete_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              {t('delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
