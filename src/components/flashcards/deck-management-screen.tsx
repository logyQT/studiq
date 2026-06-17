'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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
import { SquarePen, Trash2, Pencil, ArrowRight, Eye, Upload, CheckSquare, CheckCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { useQueryClient } from '@tanstack/react-query';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck } from '@/types/flashcards';
import { useAuth } from '@/components/providers/AuthProvider';
import { can } from '@/lib/frontend-rbac';
import { UserRole } from '@/types';
import { ImportDialog } from '@/components/flashcards/import-dialog';
import { DeckBulkActions } from '@/components/flashcards/deck-bulk-actions';
import { SpeedDial } from '@/components/shared/speed-dial';

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

interface DeckManagementScreenProps {
  apiBase: string;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

export function DeckManagementScreen({ basePath, t }: DeckManagementScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const role = user?.app_metadata?.role as UserRole | undefined;

  const { data: decks, isLoading } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks',
  });
  const createDeck = useApiMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiPost<Deck>('/api/v1/flashcards/decks', data),
    invalidateKeys: [flashcardKeys.decks.all],
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
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous);
    },
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
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(flashcardKeys.decks.all, ctx?.previous);
    },
  });
  const batchDeleteDecks = useApiMutation({
    mutationFn: (data: { ids: string[] }) =>
      apiPost('/api/v1/flashcards/decks/batch/delete', data),
    invalidateKeys: [flashcardKeys.decks.all],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Deck | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [formData, setFormData] = useState({ name: '', description: '' });

  useEffect(() => {
    if (!isSelecting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSelecting]);

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
      if (editing) {
        await updateDeck.mutateAsync({
          id: editing.id,
          name: formData.name,
          description: formData.description || undefined,
        });
      } else {
        await createDeck.mutateAsync({
          name: formData.name,
          description: formData.description || undefined,
        });
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? t('deck_updated') : t('deck_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleSelectAll() {
    if (!decks) return;
    setSelectedIds(new Set(decks.map((d) => d.id)));
  }

  function handleDeselectAll() {
    setSelectedIds(new Set());
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }

  function handleExportAll() {
    window.open('/api/v1/flashcards/export/csv', '_blank');
  }

  function handleBatchExportSelection() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    window.open(`/api/v1/flashcards/export/csv?deckIds=${ids.join(',')}`, '_blank');
  }

  async function handleBatchDeleteSelection() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await batchDeleteDecks.mutateAsync({ ids });
      toast.success(t('deck_deleted'));
      handleClearSelection();
    } catch {
      toast.error(t('delete_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteDeck.mutateAsync(deleteId);
      toast.success(t('deck_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  return (
    <div className="space-y-6">

      <div className={`flex items-center gap-2 py-1 ${isSelecting && decks && decks.length > 0 ? '' : 'invisible'}`}>
        {(isSelecting && decks && decks.length > 0) && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={selectedIds.size === decks.length ? handleDeselectAll : handleSelectAll}
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              {selectedIds.size === decks.length ? t('deselect_all') : t('select_all')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('n_selected', { count: selectedIds.size })}
            </span>
          </>
        )}
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden p-0">
              <Skeleton className="h-20 w-full rounded-none" />
              <div className="p-5 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex items-center justify-between pt-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {decks?.map((deck) => {
            const gradient = getGradient(deck.id);
            return (
              <Card
                key={deck.id}
                className={`group overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50 p-0 ${selectedIds.has(deck.id) ? 'ring-2 ring-primary' : ''}`}
                onClick={() => {
                  if (isSelecting) {
                    handleToggleSelect(deck.id);
                  } else {
                    router.push(`${basePath}/deck/${deck.id}`);
                  }
                }}
              >
                <div
                  className={`h-20 bg-gradient-to-br ${gradient} flex items-center justify-center relative`}
                >
                  <span className="text-2xl font-bold text-white/90">
                    {deck.name.charAt(0).toUpperCase()}
                  </span>
                  {isSelecting && (
                    <div className="absolute left-2 top-2 z-10">
                      <Checkbox
                        checked={selectedIds.has(deck.id)}
                        onCheckedChange={() => handleToggleSelect(deck.id)}
                        className="h-5 w-5 bg-background/80"
                      />
                    </div>
                  )}
                  {!can(role, 'deck.update', deck.created_by, user?.id) && (
                    <Eye className="absolute bottom-2 right-2 h-4 w-4 text-white/50" />
                  )}
                </div>
                <div className="p-5 pb-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold truncate">{deck.name}</h3>
                      {deck.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                          {deck.description}
                        </p>
                      )}
                    </div>
                    {can(role, 'deck.update', deck.created_by, user?.id) && !isSelecting && (
                      <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={t('common_edit')}
                          onClick={(e) => {
                            e.stopPropagation();
                            openEdit(deck);
                          }}
                        >
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          aria-label={t('common_delete')}
                          onClick={(e) => {
                            e.stopPropagation();
                            setDeleteId(deck.id);
                          }}
                        >
                          <Trash2 className="h-3 w-3 text-destructive" />
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
                <div className="px-5 pb-5 flex items-center justify-between">
                  <Badge variant="secondary">
                    {t('flashcards_count', { count: deck.flashcard_count })}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`${basePath}/deck/${deck.id}`);
                    }}
                  >
                    {t('open_deck')} <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              </Card>
            );
          })}
          {(!decks || decks.length === 0) && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              {t('no_decks')}
            </div>
          )}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('new_deck_title')}</DialogTitle>
            <DialogDescription>{editing ? t('edit_desc') : t('new_deck_desc')}</DialogDescription>
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
            <Button onClick={handleSubmit}>
              {editing ? t('common_update') : t('common_create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <DeckBulkActions
        selectedCount={selectedIds.size}
        onExport={handleBatchExportSelection}
        onDelete={handleBatchDeleteSelection}
        onClearSelection={handleClearSelection}
        t={t}
      />

      <ImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        t={t}
      />

      {!isSelecting && (
        <SpeedDial
          items={[
            { icon: SquarePen, label: t('new_deck'), onClick: openCreate },
            { icon: Upload, label: t('import_csv'), onClick: () => setImportOpen(true) },
            { icon: CheckSquare, label: t('select_cards'), onClick: () => setIsSelecting(true) },
          ]}
        />
      )}
    </div>
  );
}
