'use client';

import { Button } from '@/components/ui/button';
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
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { ExternalLink, X } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { Flashcard, Deck, Topic } from '@/types/flashcards';
import type { UserRole } from '@/types';
import { useAuth } from '@/components/providers/AuthProvider';
import { can } from '@/lib/frontend-rbac';
import { useTranslations } from 'next-intl';

const TOPIC_COLORS = [
  'bg-red-500', 'bg-blue-500', 'bg-green-500', 'bg-yellow-500',
  'bg-purple-500', 'bg-pink-500', 'bg-indigo-500', 'bg-teal-500',
  'bg-orange-500', 'bg-cyan-500',
];

function getTopicColor(name: string) {
  return TOPIC_COLORS[name.length % TOPIC_COLORS.length];
}

export interface DialogsState {
  createOpen: boolean;
  editOpen: boolean;
  deleteId: string | null;
  linkOpen: boolean;
  copyOpen: boolean;
  copyResult: { id: string; deckId: string } | null;
  activeFlashcardId: string | null;
  formData: { front: string; back: string; topicIds: string[] };
  linkDeckIds: string[];
  copyTargetDeckId: string | null;
  deckEditOpen: boolean;
  deckDeleteOpen: boolean;
  deckFormData: { name: string; description: string };
  viewTopicId: string | null;
  addTopicOpen: boolean;
  removeTopicOpen: boolean;
  topicActionIds: string[];
  selectedIds: string[];
  bulkDeleteOpen: boolean;
  bulkLinkOpen: boolean;
  bulkLinkDeckIds: string[];
  bulkMoveOpen: boolean;
  bulkMoveTargetDeckId: string | null;
  bulkCopyOpen: boolean;
  bulkCopyTargetDeckId: string | null;
  bulkTopicsOpen: boolean;
  bulkTopicsOperation: 'add' | 'remove' | 'set';
  bulkTopicIds: string[];
}

export interface DialogsHandlers {
  onCreateOpenChange: (open: boolean) => void;
  onEditOpenChange: (open: boolean) => void;
  onDeleteOpenChange: () => void;
  onLinkOpenChange: (open: boolean) => void;
  onCopyOpenChange: (open: boolean) => void;
  onCopyResultClose: () => void;
  onDeckEditOpenChange: (open: boolean) => void;
  onDeckDeleteOpenChange: (open: boolean) => void;
  onViewTopicIdChange: (id: string | null) => void;
  onAddTopicOpenChange: (open: boolean) => void;
  onRemoveTopicOpenChange: (open: boolean) => void;
  onFormDataChange: (data: { front: string; back: string; topicIds: string[] }) => void;
  onLinkDeckIdsChange: (ids: string[]) => void;
  onCopyTargetDeckIdChange: (id: string | null) => void;
  onDeckFormDataChange: (data: { name: string; description: string }) => void;
  onTopicActionIdsChange: (ids: string[]) => void;
  onCreate: () => void;
  onUpdate: () => void;
  onDelete: () => void;
  onLink: () => void;
  onCopy: () => void;
  onDeckUpdate: () => void;
  onDeckDelete: () => void;
  onAddTopicConfirm: () => void;
  onRemoveTopicConfirm: () => void;
  onBulkDelete: () => void;
  onBulkLink: () => void;
  onBulkTopics: () => void;
  onBulkMove: () => void;
  onBulkCopy: () => void;
  onBulkTopicsOperationChange: (op: 'add' | 'remove' | 'set') => void;
  onBulkLinkDeckIdsChange: (ids: string[]) => void;
  onBulkMoveTargetDeckIdChange: (id: string | null) => void;
  onBulkTopicIdsChange: (ids: string[]) => void;
  onBulkDeleteOpenChange: (open: boolean) => void;
  onBulkLinkOpenChange: (open: boolean) => void;
  onBulkMoveOpenChange: (open: boolean) => void;
  onBulkCopyOpenChange: (open: boolean) => void;
  onBulkCopyTargetDeckIdChange: (id: string | null) => void;
  onBulkTopicsOpenChange: (open: boolean) => void;
}

interface DeckDetailDialogsProps {
  state: DialogsState;
  handlers: DialogsHandlers;
  flashcards: Flashcard[];
  currentDeck: Deck | null;
  allDecks: Deck[];
  topics: Topic[];
  t: ReturnType<typeof useTranslations>;
  basePath: string;
}

export function DeckDetailDialogs({
  state,
  handlers,
  flashcards,
  currentDeck,
  allDecks,
  topics,
  t,
  basePath,
}: DeckDetailDialogsProps) {
  const router = useRouter();
  const { user } = useAuth();
  const role = user?.app_metadata?.role as UserRole | undefined;

  function toggleTopic(id: string) {
    handlers.onFormDataChange({
      ...state.formData,
      topicIds: state.formData.topicIds.includes(id)
        ? state.formData.topicIds.filter((tid) => tid !== id)
        : [...state.formData.topicIds, id],
    });
  }

  function getTopicIds(fc: Flashcard | undefined) {
    return fc?.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [];
  }

  return (
    <>
      <Dialog open={state.createOpen} onOpenChange={handlers.onCreateOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('create_title')}</DialogTitle>
            <DialogDescription>{t('create_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('front_label')}</Label>
              <Textarea
                value={state.formData.front}
                onChange={(e) => handlers.onFormDataChange({ ...state.formData, front: e.target.value })}
                placeholder={t('front_placeholder')}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('back_label')}</Label>
              <Textarea
                value={state.formData.back}
                onChange={(e) => handlers.onFormDataChange({ ...state.formData, back: e.target.value })}
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
                      checked={state.formData.topicIds.includes(topic.id)}
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
              {state.formData.topicIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 p-2 rounded-lg bg-muted">
                  {state.formData.topicIds.map((id) => {
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
            <Button variant="outline" onClick={() => { handlers.onCreateOpenChange(false); handlers.onFormDataChange({ front: '', back: '', topicIds: [] }); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onCreate}>{t('common_create')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.editOpen} onOpenChange={handlers.onEditOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('edit_title')}</DialogTitle>
            <DialogDescription>{t('edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('front_label')}</Label>
              <Textarea
                value={state.formData.front}
                onChange={(e) => handlers.onFormDataChange({ ...state.formData, front: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('back_label')}</Label>
              <Textarea
                value={state.formData.back}
                onChange={(e) => handlers.onFormDataChange({ ...state.formData, back: e.target.value })}
                rows={3}
              />
            </div>
            <div>
              <Label>{t('topics_label')}</Label>
              <div className="space-y-2 mt-2 max-h-40 overflow-y-auto">
                {topics.map((topic) => (
                  <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                    <Checkbox
                      checked={state.formData.topicIds.includes(topic.id)}
                      onCheckedChange={() => toggleTopic(topic.id)}
                    />
                    <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                    <span className="text-sm">{topic.name}</span>
                  </div>
                ))}
              </div>
              {state.formData.topicIds.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-2 p-2 rounded-lg bg-muted">
                  {state.formData.topicIds.map((id) => {
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
            <Button variant="outline" onClick={() => { handlers.onEditOpenChange(false); handlers.onFormDataChange({ front: '', back: '', topicIds: [] }); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onUpdate}>{t('common_update')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.linkOpen} onOpenChange={handlers.onLinkOpenChange}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('link_title')}</DialogTitle>
            <DialogDescription>{t('link_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {allDecks.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  checked={state.linkDeckIds.includes(d.id)}
                  onCheckedChange={() =>
                    handlers.onLinkDeckIdsChange(
                      state.linkDeckIds.includes(d.id)
                        ? state.linkDeckIds.filter((x) => x !== d.id)
                        : [...state.linkDeckIds, d.id],
                    )
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                  )}
                </div>
              </div>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_other_decks')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { handlers.onLinkOpenChange(false); handlers.onLinkDeckIdsChange([]); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onLink} disabled={state.linkDeckIds.length === 0}>
              {t('link_button', { count: state.linkDeckIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.copyOpen} onOpenChange={handlers.onCopyOpenChange}>
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
                  state.copyTargetDeckId === d.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                }`}
                onClick={() => handlers.onCopyTargetDeckIdChange(d.id)}
              >
                <div
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                    state.copyTargetDeckId === d.id ? 'border-primary' : 'border-muted-foreground'
                  }`}
                >
                  {state.copyTargetDeckId === d.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                  )}
                </div>
                <Badge variant="secondary">
                  {t('flashcards_count', { count: d.flashcard_count })}
                </Badge>
              </button>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_other_decks')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { handlers.onCopyOpenChange(false); handlers.onCopyTargetDeckIdChange(null); }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onCopy} disabled={!state.copyTargetDeckId}>
              {t('copy_button')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!state.copyResult}
        onOpenChange={(open) => { if (!open) handlers.onCopyResultClose(); }}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{t('copy_success_title')}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-3 py-4">
            <Button
              onClick={() => {
                router.push(`${basePath}/deck/${state.copyResult?.deckId}`);
                handlers.onCopyResultClose();
              }}
            >
              <ExternalLink className="mr-2 h-4 w-4" /> {t('copy_go_to_card')}
            </Button>
            <Button variant="outline" onClick={handlers.onCopyResultClose}>
              {t('copy_stay_here')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!state.deleteId}
        onOpenChange={handlers.onDeleteOpenChange}
        onConfirm={handlers.onDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <Dialog open={state.deckEditOpen} onOpenChange={handlers.onDeckEditOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('deck_edit_title')}</DialogTitle>
            <DialogDescription>{t('deck_edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <Label>{t('deck_name_label')}</Label>
              <Input
                value={state.deckFormData.name}
                onChange={(e) => handlers.onDeckFormDataChange({ ...state.deckFormData, name: e.target.value })}
                placeholder={t('deck_name_placeholder')}
              />
            </div>
            <div>
              <Label>{t('deck_description_label')}</Label>
              <Textarea
                value={state.deckFormData.description}
                onChange={(e) => handlers.onDeckFormDataChange({ ...state.deckFormData, description: e.target.value })}
                placeholder={t('deck_description_placeholder')}
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handlers.onDeckEditOpenChange(false)}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onDeckUpdate}>{t('common_update')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={state.deckDeleteOpen}
        onOpenChange={handlers.onDeckDeleteOpenChange}
        onConfirm={handlers.onDeckDelete}
        title={t('deck_delete_title')}
        description={t('deck_delete_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <Dialog
        open={!!state.viewTopicId}
        onOpenChange={(open) => { if (!open) handlers.onViewTopicIdChange(null); }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {(() => {
                const viewTopic = topics.find((tp) => tp.id === state.viewTopicId);
                return viewTopic ? (
                  <span className="flex items-center gap-2">
                    <div className={`h-5 w-5 rounded ${getTopicColor(viewTopic.name)}`} />
                    {viewTopic.name}
                  </span>
                ) : null;
              })()}
            </DialogTitle>
            <DialogDescription>
              {t('view_flashcards_for_topic', {
                count: (flashcards ?? []).filter((fc) =>
                  fc.flashcard_topic_assignments?.some((a) => a.topic_id === state.viewTopicId),
                ).length,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {(flashcards ?? [])
              .filter((fc) =>
                fc.flashcard_topic_assignments?.some((a) => a.topic_id === state.viewTopicId),
              )
              .length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {t('no_flashcards_for_topic')}
              </p>
            ) : (
              (flashcards ?? [])
                .filter((fc) =>
                  fc.flashcard_topic_assignments?.some((a) => a.topic_id === state.viewTopicId),
                )
                .map((fc) => (
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
            <Button onClick={() => handlers.onViewTopicIdChange(null)}>{t('common_close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.addTopicOpen} onOpenChange={handlers.onAddTopicOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('menu_add_topic')}</DialogTitle>
            <DialogDescription>{t('add_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {(() => {
              const fc = flashcards.find((f) => f.id === state.activeFlashcardId);
              const assignedIds = getTopicIds(fc);
              const available = topics.filter((topic) => !assignedIds.includes(topic.id));
              return (
                <>
                  {available.map((topic) => (
                    <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                      <Checkbox
                        checked={state.topicActionIds.includes(topic.id)}
                        onCheckedChange={() =>
                          handlers.onTopicActionIdsChange(
                            state.topicActionIds.includes(topic.id)
                              ? state.topicActionIds.filter((id) => id !== topic.id)
                              : [...state.topicActionIds, topic.id],
                          )
                        }
                      />
                      <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                      <span className="text-sm">{topic.name}</span>
                    </div>
                  ))}
                  {available.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t('no_other_topics_to_add')}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handlers.onAddTopicOpenChange(false)}>
              {t('common_cancel')}
            </Button>
            <Button
              onClick={handlers.onAddTopicConfirm}
              disabled={state.topicActionIds.length === 0}
            >
              {t('common_add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.removeTopicOpen} onOpenChange={handlers.onRemoveTopicOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('menu_remove_topic')}</DialogTitle>
            <DialogDescription>{t('remove_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {(() => {
              const fc = flashcards.find((f) => f.id === state.activeFlashcardId);
              const assignedIds = getTopicIds(fc);
              const assigned = topics.filter((topic) => assignedIds.includes(topic.id));
              return (
                <>
                  {assigned.map((topic) => (
                    <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                      <Checkbox
                        checked={state.topicActionIds.includes(topic.id)}
                        onCheckedChange={() =>
                          handlers.onTopicActionIdsChange(
                            state.topicActionIds.includes(topic.id)
                              ? state.topicActionIds.filter((id) => id !== topic.id)
                              : [...state.topicActionIds, topic.id],
                          )
                        }
                      />
                      <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                      <span className="text-sm">{topic.name}</span>
                    </div>
                  ))}
                  {assigned.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">
                      {t('no_topics_to_remove')}
                    </p>
                  )}
                </>
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => handlers.onRemoveTopicOpenChange(false)}>
              {t('common_cancel')}
            </Button>
            <Button
              onClick={handlers.onRemoveTopicConfirm}
              disabled={state.topicActionIds.length === 0}
            >
              {t('common_remove')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={state.bulkDeleteOpen}
        onOpenChange={handlers.onBulkDeleteOpenChange}
        onConfirm={handlers.onBulkDelete}
        title={t('bulk_delete_title', { count: state.selectedIds.length })}
        description={t('bulk_delete_desc', { count: state.selectedIds.length })}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <Dialog open={state.bulkLinkOpen} onOpenChange={(open) => {
        if (!open) {
          handlers.onBulkLinkOpenChange(false);
          handlers.onBulkLinkDeckIdsChange([]);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('link_title')}</DialogTitle>
            <DialogDescription>{t('link_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {allDecks.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 rounded-lg border">
                <Checkbox
                  checked={state.bulkLinkDeckIds.includes(d.id)}
                  onCheckedChange={() =>
                    handlers.onBulkLinkDeckIdsChange(
                      state.bulkLinkDeckIds.includes(d.id)
                        ? state.bulkLinkDeckIds.filter((x) => x !== d.id)
                        : [...state.bulkLinkDeckIds, d.id],
                    )
                  }
                />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                  )}
                </div>
              </div>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_other_decks')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              handlers.onBulkLinkOpenChange(false);
              handlers.onBulkLinkDeckIdsChange([]);
            }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onBulkLink} disabled={state.bulkLinkDeckIds.length === 0}>
              {t('link_button', { count: state.bulkLinkDeckIds.length })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.bulkMoveOpen} onOpenChange={(open) => {
        if (!open) {
          handlers.onBulkMoveOpenChange(false);
          handlers.onBulkMoveTargetDeckIdChange(null);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('bulk_move')}</DialogTitle>
            <DialogDescription>{t('bulk_move')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {allDecks.map((d) => (
              <button
                key={d.id}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  state.bulkMoveTargetDeckId === d.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                }`}
                onClick={() => handlers.onBulkMoveTargetDeckIdChange(d.id)}
              >
                <div
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                    state.bulkMoveTargetDeckId === d.id ? 'border-primary' : 'border-muted-foreground'
                  }`}
                >
                  {state.bulkMoveTargetDeckId === d.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                  )}
                </div>
              </button>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_other_decks')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              handlers.onBulkMoveOpenChange(false);
              handlers.onBulkMoveTargetDeckIdChange(null);
            }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onBulkMove} disabled={!state.bulkMoveTargetDeckId}>
              {t('bulk_move')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.bulkCopyOpen} onOpenChange={(open) => {
        if (!open) {
          handlers.onBulkCopyOpenChange(false);
          handlers.onBulkCopyTargetDeckIdChange(null);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('bulk_copy')}</DialogTitle>
            <DialogDescription>{t('bulk_copy')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 mt-2 max-h-60 overflow-y-auto">
            {allDecks.map((d) => (
              <button
                key={d.id}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-colors ${
                  state.bulkCopyTargetDeckId === d.id ? 'border-primary bg-primary/5' : 'hover:bg-muted'
                }`}
                onClick={() => handlers.onBulkCopyTargetDeckIdChange(d.id)}
              >
                <div
                  className={`h-4 w-4 rounded-full border-2 flex items-center justify-center ${
                    state.bulkCopyTargetDeckId === d.id ? 'border-primary' : 'border-muted-foreground'
                  }`}
                >
                  {state.bulkCopyTargetDeckId === d.id && <div className="h-2 w-2 rounded-full bg-primary" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{d.name}</p>
                  {d.description && (
                    <p className="text-xs text-muted-foreground truncate">{d.description}</p>
                  )}
                </div>
              </button>
            ))}
            {allDecks.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_other_decks')}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              handlers.onBulkCopyOpenChange(false);
              handlers.onBulkCopyTargetDeckIdChange(null);
            }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onBulkCopy} disabled={!state.bulkCopyTargetDeckId}>
              {t('bulk_copy')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={state.bulkTopicsOpen} onOpenChange={(open) => {
        if (!open) {
          handlers.onBulkTopicsOpenChange(false);
          handlers.onBulkTopicIdsChange([]);
        }
      }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('bulk_topics')}</DialogTitle>
            <DialogDescription>{t('bulk_topics')}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 py-2">
            <Button
              variant={state.bulkTopicsOperation === 'add' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                handlers.onBulkTopicsOperationChange('add');
                handlers.onBulkTopicIdsChange([]);
              }}
            >
              {t('menu_add_topic')}
            </Button>
            <Button
              variant={state.bulkTopicsOperation === 'remove' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                handlers.onBulkTopicsOperationChange('remove');
                handlers.onBulkTopicIdsChange([]);
              }}
            >
              {t('menu_remove_topic')}
            </Button>
            <Button
              variant={state.bulkTopicsOperation === 'set' ? 'default' : 'outline'}
              size="sm"
              onClick={() => {
                handlers.onBulkTopicsOperationChange('set');
                handlers.onBulkTopicIdsChange([]);
              }}
            >
              {t('bulk_topics_set')}
            </Button>
          </div>
          <div className="space-y-2 max-h-60 overflow-y-auto py-2">
            {topics.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {t('no_topics_available')}
              </p>
            ) : (
              topics.map((topic) => (
                <div key={topic.id} className="flex items-center gap-3 p-2 rounded-lg border">
                  <Checkbox
                    checked={state.bulkTopicIds.includes(topic.id)}
                    onCheckedChange={() =>
                      handlers.onBulkTopicIdsChange(
                        state.bulkTopicIds.includes(topic.id)
                          ? state.bulkTopicIds.filter((id) => id !== topic.id)
                          : [...state.bulkTopicIds, topic.id],
                      )
                    }
                  />
                  <div className={`h-2 w-2 rounded-full ${getTopicColor(topic.name)}`} />
                  <span className="text-sm">{topic.name}</span>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              handlers.onBulkTopicsOpenChange(false);
              handlers.onBulkTopicIdsChange([]);
            }}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handlers.onBulkTopics} disabled={state.bulkTopicIds.length === 0}>
              {t('common_update')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
