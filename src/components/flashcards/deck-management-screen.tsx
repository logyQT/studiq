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
  Plus,
  FolderOpen,
  MoreVertical,
  Search,
  X,
  FileUp,
} from 'lucide-react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { Checkbox } from '@/components/ui/checkbox';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
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
import { getGradientHex } from '@/lib/color-utils';
import { useDebounce } from '@/hooks/use-debounce';

interface DeckManagementScreenProps {
  apiBase: string;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

const STORAGE_KEY = 'flashcard_decks_filters';

function loadPersistedFilters() {
  if (typeof window === 'undefined')
    return { owner: 'all', sortBy: 'created_at', sortOrder: 'desc' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { owner: 'all', sortBy: 'created_at', sortOrder: 'desc' };
}

export function DeckManagementScreen({ basePath, t }: DeckManagementScreenProps) {
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.app_metadata?.role as UserRole | undefined;

  const persisted = loadPersistedFilters();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [owner, setOwner] = useState(persisted.owner);
  const [sortBy, setSortBy] = useState(persisted.sortBy);
  const [sortOrder, setSortOrder] = useState(persisted.sortOrder);

  const filters = {
    q: debouncedSearch || undefined,
    owner: owner !== 'all' ? owner : undefined,
    sortBy,
    sortOrder,
  };

  const queryString = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
  ).toString();

  const { data: decks, isLoading } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.list(filters),
    url: `/api/v1/flashcards/decks${queryString ? `?${queryString}` : ''}`,
  });

  function persistFilters(o: string, sb: string, so: string) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ owner: o, sortBy: sb, sortOrder: so }));
    } catch {
      /* ignore */
    }
  }

  const createDeck = useApiMutation({
    mutationFn: (data: { name: string; description?: string }) =>
      apiPost<Deck>('/api/v1/flashcards/decks', data),
    invalidateKeys: [flashcardKeys.decks.all],
  });
  const updateDeck = useApiMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string; description?: string }) =>
      apiPut<Deck>(`/api/v1/flashcards/decks/${id}`, data),
    invalidateKeys: [flashcardKeys.decks.all],
  });
  const deleteDeck = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/decks/${id}`),
    invalidateKeys: [flashcardKeys.decks.all],
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

  const canSeeOrg =
    role === UserRole.TEACHER || role === UserRole.UNIVERSITY_ADMIN || role === UserRole.SYS_ADMIN;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3 max-sm:hidden">
        <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder={t('search_placeholder')}
            className="pl-9 pr-9"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Select
          value={owner}
          onValueChange={(v) => {
            setOwner(v);
            persistFilters(v, sortBy, sortOrder);
          }}
        >
          <SelectTrigger className="w-35 truncate">
            <SelectValue placeholder={t('owner_all')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('owner_all')}</SelectItem>
            <SelectItem value="mine">{t('owner_mine')}</SelectItem>
            {canSeeOrg && <SelectItem value="org">{t('owner_org')}</SelectItem>}
            <SelectItem value="shared">{t('owner_shared')}</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={`${sortBy}:${sortOrder}`}
          onValueChange={(v) => {
            const [sb, so] = v.split(':');
            setSortBy(sb);
            setSortOrder(so);
            persistFilters(owner, sb, so);
          }}
        >
          <SelectTrigger className="w-37.5 truncate">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_at:desc">{t('sort_newest')}</SelectItem>
            <SelectItem value="updated_at:desc">{t('sort_recent')}</SelectItem>
            <SelectItem value="created_at:asc">{t('sort_oldest')}</SelectItem>
            <SelectItem value="name:asc">{t('sort_name_asc')}</SelectItem>
            <SelectItem value="name:desc">{t('sort_name_desc')}</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2 sm:ml-auto">
          <Button variant="outline" className="justify-start" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4" /> {t('common_import')}
          </Button>
          <Button className="justify-start" onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t('new_deck')}
          </Button>
        </div>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="flex flex-col h-full max-sm:py-0 min-w-0">
              {/* Mobile Skeleton */}
              <div className="flex items-center gap-3 p-4 sm:hidden">
                <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
              </div>
              {/* Desktop Skeleton */}
              <div className="hidden sm:flex flex-col h-full p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-xl" />
                  <Skeleton className="h-6 w-3/4" />
                </div>
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </div>
                <div className="flex items-center justify-between pt-4 mt-auto">
                  <Skeleton className="h-6 w-16 rounded-full" />
                  <Skeleton className="h-8 w-24 rounded-md" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {decks?.map((deck) => {
            const gradientHex = getGradientHex(deck.id);
            return (
              <Card
                key={deck.id}
                className={`group cursor-pointer flex flex-col h-full overflow-hidden transition-all duration-300 ease-out sm:hover:-translate-y-1 sm:hover:shadow-lg sm:hover:border-primary/40 ${
                  selectedIds.has(deck.id) ? 'ring-2 ring-primary border-transparent' : ''
                } max-sm:py-0 min-w-0 p-0`}
                onClick={() => {
                  if (isSelecting) {
                    handleToggleSelect(deck.id);
                  } else {
                    router.push(`${basePath}/decks/${deck.id}`);
                  }
                }}
              >
                {/* Mobile: Completely Revamped compact row */}
                <div className="relative flex items-center justify-between gap-3 p-3.5 sm:hidden max-w-[calc(100vw-2rem)]">
                  {isSelecting && (
                    <div className="absolute top-4 right-4 z-10">
                      <Checkbox
                        checked={selectedIds.has(deck.id)}
                        onCheckedChange={() => handleToggleSelect(deck.id)}
                        className="h-4 w-4 bg-background/90 border-muted-foreground/40 shadow-sm"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className="relative shrink-0">
                      <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/40 shadow-sm flex items-center justify-center">
                        <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                          <defs>
                            <linearGradient id={`mob-grad-${deck.id}`} x1="0" y1="0" x2="1" y2="1">
                              <stop offset="0%" stopColor={gradientHex.from} />
                              <stop offset="100%" stopColor={gradientHex.to} />
                            </linearGradient>
                          </defs>
                          <path
                            d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                            stroke={`url(#mob-grad-${deck.id})`}
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </div>
                    </div>
                    {/* Aligned Typography Container */}
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <h3 className="text-[15px] font-bold tracking-tight text-foreground truncate">
                        {deck.name}
                      </h3>
                      <div className="flex items-center gap-1.5 text-muted-foreground/80">
                        <Badge
                          variant="secondary"
                          className="bg-secondary/40 text-secondary-foreground hover:bg-secondary/40 border-transparent text-[11px] font-medium leading-none px-1.5 py-0.5 shadow-none"
                        >
                          {t('flashcards_count', { count: deck.flashcard_count })}
                        </Badge>
                        {!can(role, 'deck.update', deck.created_by, user?.id) && (
                          <span className="flex items-center text-[11px] text-muted-foreground/60 gap-0.5 font-medium ml-0.5">
                            <Eye className="h-3 w-3" /> {t('view_deck')}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Context Actions Context or Standard Chevron indicator on Mobile */}
                  {!isSelecting ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground/80 hover:text-foreground shrink-0 -mr-1"
                        >
                          <MoreVertical className="h-4 w-4" />
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
                  ) : (
                    <div className="w-5 shrink-0" />
                  )}
                </div>

                {/* Desktop: Card grid item */}
                <div className="hidden sm:flex flex-col flex-1 p-5 relative">
                  {isSelecting && (
                    <div className="absolute top-4 right-4 z-10">
                      <Checkbox
                        checked={selectedIds.has(deck.id)}
                        onCheckedChange={() => handleToggleSelect(deck.id)}
                        className="h-4 w-4 bg-background/80 shadow-sm"
                      />
                    </div>
                  )}

                  {/* Header: Icon + Title */}
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0 flex-1">
                      <div className="shrink-0">
                        <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center">
                          <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                            <defs>
                              <linearGradient
                                id={`deck-grad-${deck.id}`}
                                x1="0"
                                y1="0"
                                x2="1"
                                y2="1"
                              >
                                <stop offset="0%" stopColor={gradientHex.from} />
                                <stop offset="100%" stopColor={gradientHex.to} />
                              </linearGradient>
                            </defs>
                            <path
                              d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                              stroke={`url(#deck-grad-${deck.id})`}
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />
                          </svg>
                        </div>
                      </div>
                      <h3 className="text-lg font-bold tracking-tight text-foreground truncate min-w-0">
                        {deck.name}
                      </h3>
                    </div>

                    {!isSelecting && (
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mr-2">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                            >
                              <MoreVertical className="h-4 w-4" />
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

                  {/* Body: Description forced to 2 lines max */}
                  <div className="mt-3 mb-4 flex-1">
                    {deck.description && (
                      <p className="text-sm text-muted-foreground/90 leading-relaxed line-clamp-2">
                        {deck.description}
                      </p>
                    )}
                  </div>

                  {/* Footer: Anchored to bottom */}
                  <div className="mt-auto flex items-center justify-between pt-1">
                    <Badge
                      variant="secondary"
                      className="bg-secondary/50 text-secondary-foreground hover:bg-secondary/70 border-transparent shadow-none font-medium px-2.5 py-0.5"
                    >
                      {t('flashcards_count', { count: deck.flashcard_count })}
                    </Badge>

                    {can(role, 'deck.update', deck.created_by, user?.id) ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 font-semibold px-2 -mr-2 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`${basePath}/decks/${deck.id}`);
                        }}
                      >
                        {t('manage_deck')} <ArrowRight className="h-4 w-4" />
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 font-semibold px-2 -mr-2 transition-colors"
                        onClick={(e) => {
                          e.stopPropagation();
                          router.push(`${basePath}/decks/${deck.id}`);
                        }}
                      >
                        {t('view_deck')} <Eye className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
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
                <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center shrink-0">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id="dialog-grad" x1="0" y1="0" x2="1" y2="1">
                        <stop
                          offset="0%"
                          stopColor={getGradientHex(editing?.id ?? 'dialog').from}
                        />
                        <stop
                          offset="100%"
                          stopColor={getGradientHex(editing?.id ?? 'dialog').to}
                        />
                      </linearGradient>
                    </defs>
                    <path
                      d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                      stroke="url(#dialog-grad)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
                <div className="flex-1 space-y-3">
                  <Input
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder={t('name_placeholder')}
                    className="text-lg font-bold tracking-tight h-auto py-0 px-0 border-0 border-b rounded-none focus-visible:ring-0 focus-visible:border-primary"
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
        <div className="sm:hidden">
          <SpeedDial
            items={[
              { icon: SquarePen, label: t('new_deck'), onClick: openCreate },
              { icon: Upload, label: t('common_import'), onClick: () => setImportOpen(true) },
              { icon: CheckSquare, label: t('select_cards'), onClick: () => setIsSelecting(true) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
