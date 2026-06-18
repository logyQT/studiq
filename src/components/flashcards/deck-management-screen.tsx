'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  SquarePen,
  ArrowRight,
  Eye,
  Upload,
  CheckSquare,
  CheckCheck,
  Plus,
  FolderOpen,
  MoreVertical,
} from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
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
import { DeckContextMenu } from '@/components/flashcards/deck-context-menu';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
} from '@/components/ui/dropdown-menu';
import { DeckBulkActions } from '@/components/flashcards/deck-bulk-actions';
import { SpeedDial } from '@/components/shared/speed-dial';
import { GRADIENTS, getGradient } from '@/lib/color-utils';

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
    mutationFn: (data: { ids: string[] }) => apiPost('/api/v1/flashcards/decks/batch/delete', data),
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
      {isSelecting && decks && decks.length > 0 && (
        <div className="flex items-center gap-2 py-1">
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
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
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
                className={`group cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50 ${selectedIds.has(deck.id) ? 'ring-2 ring-primary' : ''}`}
                onClick={() => {
                  if (isSelecting) {
                    handleToggleSelect(deck.id);
                  } else {
                    router.push(`${basePath}/deck/${deck.id}`);
                  }
                }}
              >
                <div className="p-5 pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 min-w-0 flex-1">
                      <div className="relative shrink-0">
                        <div
                          className={`h-10 w-10 rounded-lg bg-gradient-to-br ${gradient} flex items-center justify-center`}
                        >
                          <FolderOpen className="h-5 w-5 text-white" />
                          {!can(role, 'deck.update', deck.created_by, user?.id) && (
                            <Eye className="absolute -bottom-1 -right-1 h-3 w-3 text-white/50" />
                          )}
                        </div>
                        {isSelecting && (
                          <div className="absolute -top-2 -left-2 z-10">
                            <Checkbox
                              checked={selectedIds.has(deck.id)}
                              onCheckedChange={() => handleToggleSelect(deck.id)}
                              className="h-4 w-4 bg-background/80"
                            />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="text-lg font-semibold truncate">{deck.name}</h3>
                        {deck.description && (
                          <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                            {deck.description}
                          </p>
                        )}
                      </div>
                    </div>
                    {!isSelecting && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 ml-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button variant="ghost" size="icon" className="h-7 w-7">
                              <MoreVertical className="h-3 w-3" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DeckContextMenu
                              t={t}
                              canUpdate={can(role, 'deck.update', deck.created_by, user?.id)}
                              canDelete={can(role, 'deck.delete', deck.created_by, user?.id)}
                              onSelect={() => {
                                setIsSelecting(true);
                                handleToggleSelect(deck.id);
                              }}
                              onEdit={() => openEdit(deck)}
                              onDelete={() => setDeleteId(deck.id)}
                              onImport={() => setImportOpen(true)}
                              onExport={() =>
                                window.open(
                                  `/api/v1/flashcards/export/csv?deckIds=${deck.id}`,
                                  '_blank',
                                )
                              }
                            />
                          </DropdownMenuContent>
                        </DropdownMenu>
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
            <Empty className="col-span-full">
              <EmptyMedia>
                <FolderOpen className="h-10 w-10 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>{t('no_decks')}</EmptyTitle>
              <EmptyDescription>
                <Button variant="outline" size="sm" onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" /> {t('new_deck')}
                </Button>
              </EmptyDescription>
            </Empty>
          )}
        </div>
      )}

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setTimeout(resetForm, 200);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('new_deck_title')}</DialogTitle>
            <DialogDescription>{editing ? t('edit_desc') : t('new_deck_desc')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Card className="p-5 pb-3">
              <div className="flex items-start gap-3">
                <div
                  className={`h-10 w-10 rounded-lg bg-gradient-to-br ${editing ? getGradient(editing.id) : GRADIENTS[0]} flex items-center justify-center shrink-0`}
                >
                  <FolderOpen className="h-5 w-5 text-white" />
                </div>
                <div className="flex-1 space-y-3">
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t('name_placeholder')}
                    className="text-lg font-semibold h-auto py-0 px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
                  />
                  <Textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    placeholder={t('description_placeholder')}
                    rows={2}
                    className="text-sm text-muted-foreground resize-none px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
                  />
                </div>
              </div>
            </Card>
            <div className="mt-3">
              <Badge variant="secondary">
                {t('flashcards_count', { count: editing?.flashcard_count ?? 0 })}
              </Badge>
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

      <ImportDialog open={importOpen} onOpenChange={setImportOpen} t={t} />

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
