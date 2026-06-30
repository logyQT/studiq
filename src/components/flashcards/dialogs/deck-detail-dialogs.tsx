'use client';

import type { useTranslations } from 'next-intl';
import { BulkDialogs } from '@/components/flashcards/dialogs/bulk-dialogs';
import { DeckDialogs } from '@/components/flashcards/dialogs/deck-dialogs';
import { SingleCardDialogs } from '@/components/flashcards/dialogs/single-card-dialogs';
import { TopicDialogs } from '@/components/flashcards/dialogs/topic-dialogs';
import { useAuth } from '@/components/providers/AuthProvider';
import { useOrgs } from '@/hooks/use-orgs';
import { can } from '@/lib/frontend-rbac';
import type { UserRole } from '@/types';
import type { Deck, Flashcard, Topic } from '@/types/flashcards';

export interface DialogsState {
  deleteId: string | null;
  linkOpen: boolean;
  copyOpen: boolean;
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
  onDeleteOpenChange: () => void;
  onLinkOpenChange: (open: boolean) => void;
  onCopyOpenChange: (open: boolean) => void;
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
  onDeckUpdate: (data: { name: string; description: string }) => void;
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
  currentDeck: _currentDeck,
  allDecks,
  topics,
  t,
  basePath,
}: DeckDetailDialogsProps) {
  const { user } = useAuth();
  const role = user?.app_metadata?.role as UserRole | undefined;
  const { activeOrg } = useOrgs();

  const ownedDecks = allDecks.filter((d) =>
    can(role, 'deck.update', d.created_by, user?.id, activeOrg?.id),
  );

  return (
    <>
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

      <DeckDialogs
        t={t}
        deckEditOpen={state.deckEditOpen}
        deckDeleteOpen={state.deckDeleteOpen}
        onDeckEditOpenChange={handlers.onDeckEditOpenChange}
        onDeckDeleteOpenChange={handlers.onDeckDeleteOpenChange}
        onDeckUpdate={handlers.onDeckUpdate}
        onDeckDelete={handlers.onDeckDelete}
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
