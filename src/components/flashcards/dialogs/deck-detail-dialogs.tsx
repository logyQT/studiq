'use client';

import type { useTranslations } from 'next-intl';
import { BulkDialogs } from '@/components/flashcards/dialogs/bulk-dialogs';
import { CreateCardDialog } from '@/components/flashcards/dialogs/create-card-dialog';
import { DeckDialogs } from '@/components/flashcards/dialogs/deck-dialogs';
import { SingleCardDialogs } from '@/components/flashcards/dialogs/single-card-dialogs';
import { TopicDialogs } from '@/components/flashcards/dialogs/topic-dialogs';
import { ReportQuestionDialog } from '@/components/question-reports/report-question-dialog';
import { usePermission } from '@/hooks/use-permission';
import type { Deck, Flashcard, Topic } from '@/server/models';

export interface DialogsState {
  createCardOpen: boolean;
  editCard: Flashcard | null;
  deleteId: string | null;
  linkOpen: boolean;
  copyOpen: boolean;
  reportOpen: boolean;
  copyResult: { id: string; deckId: string } | null;
  activeFlashcardId: string | null;
  linkDeckIds: string[];
  copyTargetDeckId: string | null;
  deckEditOpen: boolean;
  deckDeleteOpen: boolean;
  viewTopicId: string | null;
  addTopicOpen: boolean;
  manageTopicOpen: boolean;
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
  onCreateCardOpenChange: (open: boolean) => void;
  onEditCardOpenChange: (card: Flashcard | null) => void;
  onDeleteOpenChange: () => void;
  onLinkOpenChange: (open: boolean) => void;
  onCopyOpenChange: (open: boolean) => void;
  onReportOpenChange: (open: boolean) => void;
  onCopyResultClose: () => void;
  onDeckEditOpenChange: (open: boolean) => void;
  onDeckDeleteOpenChange: (open: boolean) => void;
  onViewTopicIdChange: (id: string | null) => void;
  onAddTopicOpenChange: (open: boolean) => void;
  onManageTopicOpenChange: (open: boolean) => void;
  onLinkDeckIdsChange: (ids: string[]) => void;
  onCopyTargetDeckIdChange: (id: string | null) => void;
  onTopicActionIdsChange: (ids: string[]) => void;
  onDelete: () => void;
  onLink: () => void;
  onCopy: () => void;
  onDeckUpdate: (data: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }) => void;
  onDeckDelete: () => void;
  onAddTopicConfirm: () => void;
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

interface GroupOption {
  id: string;
  name: string;
}

interface DeckDetailDialogsProps {
  state: DialogsState;
  handlers: DialogsHandlers;
  flashcards: Flashcard[];
  currentDeck: Deck | null;
  allDecks: Deck[];
  topics: Topic[];
  groups?: GroupOption[];
  t: ReturnType<typeof useTranslations>;
  basePath: string;
  deckId: string;
}

export function DeckDetailDialogs({
  state,
  handlers,
  flashcards,
  currentDeck,
  allDecks,
  topics,
  groups,
  t,
  basePath,
  deckId,
}: DeckDetailDialogsProps) {
  const permission = usePermission();

  const ownedDecks = allDecks.filter((d) => permission('deck.update', { createdBy: d.created_by }));

  const activeFlashcard = flashcards.find((fc) => fc.id === state.activeFlashcardId);

  return (
    <>
      <CreateCardDialog
        deckId={deckId}
        open={state.createCardOpen}
        onOpenChange={handlers.onCreateCardOpenChange}
        topics={topics}
      />

      <CreateCardDialog
        deckId={deckId}
        open={!!state.editCard}
        onOpenChange={(open) => {
          if (!open) handlers.onEditCardOpenChange(null);
        }}
        topics={topics}
        flashcard={state.editCard}
        onSuccess={() => handlers.onEditCardOpenChange(null)}
      />

      <SingleCardDialogs
        t={t}
        basePath={basePath}
        ownedDecks={ownedDecks}
        linkOpen={state.linkOpen}
        linkDeckIds={state.linkDeckIds}
        onLinkOpenChange={handlers.onLinkOpenChange}
        onLinkDeckIdsChange={handlers.onLinkDeckIdsChange}
        onLink={handlers.onLink}
        copyOpen={state.copyOpen}
        copyTargetDeckId={state.copyTargetDeckId}
        onCopyOpenChange={handlers.onCopyOpenChange}
        onCopyTargetDeckIdChange={handlers.onCopyTargetDeckIdChange}
        onCopy={handlers.onCopy}
        copyResult={state.copyResult}
        onCopyResultClose={handlers.onCopyResultClose}
        deleteId={state.deleteId}
        onDeleteOpenChange={handlers.onDeleteOpenChange}
        onDelete={handlers.onDelete}
      />

      {activeFlashcard?.question_id && (
        <ReportQuestionDialog
          questionId={activeFlashcard.question_id}
          open={state.reportOpen}
          onOpenChange={handlers.onReportOpenChange}
        />
      )}

      <DeckDialogs
        t={t}
        deckEditOpen={state.deckEditOpen}
        deckDeleteOpen={state.deckDeleteOpen}
        onDeckEditOpenChange={handlers.onDeckEditOpenChange}
        onDeckDeleteOpenChange={handlers.onDeckDeleteOpenChange}
        onDeckUpdate={handlers.onDeckUpdate}
        onDeckDelete={handlers.onDeckDelete}
        initialValues={
          currentDeck
            ? {
                name: currentDeck.name,
                description: currentDeck.description ?? '',
                visibility: currentDeck.visibility,
                groupIds: currentDeck.groupIds ?? [],
              }
            : null
        }
        groups={groups}
      />

      <TopicDialogs
        t={t}
        topics={topics}
        flashcards={flashcards}
        activeFlashcardId={state.activeFlashcardId}
        viewTopicId={state.viewTopicId}
        onViewTopicIdChange={handlers.onViewTopicIdChange}
        addTopicOpen={state.addTopicOpen}
        onAddTopicOpenChange={handlers.onAddTopicOpenChange}
        manageTopicOpen={state.manageTopicOpen}
        onManageTopicOpenChange={handlers.onManageTopicOpenChange}
        onTopicActionIdsChange={handlers.onTopicActionIdsChange}
        onAddTopicConfirm={handlers.onAddTopicConfirm}
      />

      <BulkDialogs
        t={t}
        ownedDecks={ownedDecks}
        selectedIds={state.selectedIds}
        bulkDeleteOpen={state.bulkDeleteOpen}
        onBulkDeleteChange={handlers.onBulkDeleteOpenChange}
        onBulkDelete={handlers.onBulkDelete}
        bulkLinkOpen={state.bulkLinkOpen}
        bulkLinkDeckIds={state.bulkLinkDeckIds}
        onBulkLinkChange={handlers.onBulkLinkOpenChange}
        onBulkLinkDeckIdsChange={handlers.onBulkLinkDeckIdsChange}
        onBulkLink={handlers.onBulkLink}
        bulkMoveOpen={state.bulkMoveOpen}
        bulkMoveTargetDeckId={state.bulkMoveTargetDeckId}
        onBulkMoveChange={handlers.onBulkMoveOpenChange}
        onBulkMoveTargetDeckIdChange={handlers.onBulkMoveTargetDeckIdChange}
        onBulkMove={handlers.onBulkMove}
        bulkCopyOpen={state.bulkCopyOpen}
        bulkCopyTargetDeckId={state.bulkCopyTargetDeckId}
        onBulkCopyChange={handlers.onBulkCopyOpenChange}
        onBulkCopyTargetDeckIdChange={handlers.onBulkCopyTargetDeckIdChange}
        onBulkCopy={handlers.onBulkCopy}
        bulkTopicsOpen={state.bulkTopicsOpen}
        bulkTopicsOperation={state.bulkTopicsOperation}
        bulkTopicIds={state.bulkTopicIds}
        onBulkTopicsChange={handlers.onBulkTopicsOpenChange}
        onBulkTopicsOperationChange={handlers.onBulkTopicsOperationChange}
        onBulkTopicIdsChange={handlers.onBulkTopicIdsChange}
        onBulkTopics={handlers.onBulkTopics}
        topics={topics}
      />
    </>
  );
}
