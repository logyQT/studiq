'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { toast } from 'sonner';
import { Plus, Pencil, Trash2 } from 'lucide-react';

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
  created_at: string;
}

export default function FlashcardTopicsPage() {
  const dl = useTranslations('DashboardLayout');
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '' });

  useEffect(() => {
    fetch('/api/v1/flashcard-topics')
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        setTopics(data);
        setLoading(false);
      })
      .catch(() => {
        setTopics([]);
        setLoading(false);
      });
  }, []);

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
      toast.error('Name is required');
      return;
    }
    try {
      const url = editing ? `/api/v1/flashcard-topics/${editing.id}` : '/api/v1/flashcard-topics';
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: formData.name }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (editing) {
        setTopics(topics.map((t) => (t.id === data.id ? data : t)));
      } else {
        setTopics([{ ...data, flashcard_count: 0 }, ...topics]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? 'Topic updated' : 'Topic created');
    } catch {
      toast.error('Failed to save topic');
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/v1/flashcard-topics/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setTopics(topics.filter((t) => t.id !== deleteId));
      toast.success('Topic deleted');
    } catch {
      toast.error('Failed to delete topic');
    }
    setDeleteId(null);
  }

  if (loading) return <div className="flex justify-center py-12">{dl('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Flashcard Topics</h2>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Topic
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {topics.map((topic) => (
          <Card key={topic.id} className="group">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-lg truncate">{topic.name}</CardTitle>
                  <CardDescription>{topic.flashcard_count} flashcards</CardDescription>
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => openEdit(topic)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setDeleteId(topic.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
          </Card>
        ))}
        {topics.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No topics yet. Create your first topic!
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Topic' : 'New Topic'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update the topic name' : 'Create a new topic for flashcards'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>Topic Name</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ name: e.target.value })}
                placeholder="e.g., JavaScript Basics"
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
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editing ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Topic</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the topic from all flashcards. Flashcards themselves will not be
              deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive text-destructive-foreground"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
