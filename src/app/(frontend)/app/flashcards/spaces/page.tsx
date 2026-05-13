'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
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

interface Space {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
  flashcard_space_assignments: Array<{ flashcard_id: string }>;
}

export default function FlashcardSpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([]);
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Space | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    flashcardIds: [] as string[],
  });

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/flashcard-spaces').then((r) => (r.ok ? r.json() : [])),
      fetch('/api/v1/flashcards').then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([s, f]) => {
        setSpaces(s);
        setFlashcards(f);
        setLoading(false);
      })
      .catch(() => {
        setSpaces([]);
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

  function openEdit(space: Space) {
    setEditing(space);
    setFormData({
      name: space.name,
      description: space.description || '',
      flashcardIds: space.flashcard_space_assignments?.map((a) => a.flashcard_id) ?? [],
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
      toast.error('Name is required');
      return;
    }
    try {
      const url = editing ? `/api/v1/flashcard-spaces/${editing.id}` : '/api/v1/flashcard-spaces';
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
      const data = await res.json();
      if (editing) {
        setSpaces(spaces.map((s) => (s.id === data.id ? data : s)));
      } else {
        setSpaces([{ ...data, flashcard_count: formData.flashcardIds.length }, ...spaces]);
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? 'Space updated' : 'Space created');
    } catch {
      toast.error('Failed to save space');
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      const res = await fetch(`/api/v1/flashcard-spaces/${deleteId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setSpaces(spaces.filter((s) => s.id !== deleteId));
      toast.success('Space deleted');
    } catch {
      toast.error('Failed to delete space');
    }
    setDeleteId(null);
  }

  if (loading) return <div className="flex justify-center py-12">Loading...</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link href="/app/flashcards">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="mr-2 h-4 w-4" /> Back
            </Button>
          </Link>
          <h2 className="text-2xl font-bold">My Spaces</h2>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> New Space
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {spaces.map((space) => (
          <Card key={space.id} className="group">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="min-w-0">
                  <CardTitle className="text-lg truncate">{space.name}</CardTitle>
                  {space.description && (
                    <CardDescription className="line-clamp-2">{space.description}</CardDescription>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Edit"
                    onClick={() => openEdit(space)}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    aria-label="Delete"
                    onClick={() => setDeleteId(space.id)}
                  >
                    <Trash2 className="h-3 w-3 text-destructive" />
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Badge variant="secondary">{space.flashcard_count} flashcards</Badge>
            </CardContent>
          </Card>
        ))}
        {spaces.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            No spaces yet. Create your first space!
          </div>
        )}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Space' : 'New Space'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Update your space' : 'Create a new collection of flashcards'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label htmlFor="space-name">Name</Label>
              <Input
                id="space-name"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="e.g., Exam Prep"
              />
            </div>
            <div>
              <Label htmlFor="space-description">Description (optional)</Label>
              <Textarea
                id="space-description"
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="What is this space for?"
                rows={2}
              />
            </div>
            <div>
              <Label>Flashcards</Label>
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
                  <p className="text-sm text-muted-foreground">No flashcards available yet</p>
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
              Cancel
            </Button>
            <Button onClick={handleSubmit}>{editing ? 'Update' : 'Create'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Space</AlertDialogTitle>
            <AlertDialogDescription>
              This will delete the space. Flashcards will not be deleted.
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
