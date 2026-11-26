import type { RequestContext } from '@studiq/authz';
import { dbRows } from '@studiq/server/lib/supabase/rows';
import { check, Permission } from '@studiq/server/lib/authz';
import { wrapService } from '@studiq/server/lib/observability';
import { failure, type ServiceResult, success } from '@studiq/server/lib/service-result';
import { createClient } from '@studiq/server/lib/supabase/server';
import { toDbFailure } from '@studiq/server/lib/supabase-errors';
import type { CsvImportBatch } from '@studiq/server/models/flashcard-import.model';
import { flashcardService } from '@studiq/server/services/flashcard.service';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../types/database';

export class FlashcardImportService {
  constructor(private clientFactory: () => Promise<SupabaseClient<Database>>) {}

  /** Writes rows that already passed validation, all of them or none past the plan limit. */
  async importCsv(
    data: CsvImportBatch,
    ctx: RequestContext,
  ): Promise<ServiceResult<{ imported: number }>> {
    const supabase = await this.clientFactory();

    let defaultDeckId: string | undefined = data.deckId;

    if (data.deckId) {
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', data.deckId)
        .single();

      if (!deck) return failure('NOT_FOUND');
      await check(ctx, Permission.DECK_UPDATE, deck);
    }

    // With no valid row there is nothing to write, not even an empty deck or a topic.
    if (data.cards.length === 0) return success({ imported: 0 });

    await flashcardService.checkCapacity(supabase, ctx, data.cards.length);

    if (!data.deckId) {
      const hasDeckColumn = data.cards.some((c) => c.deck);
      if (!hasDeckColumn) {
        const deckName = data.defaultDeckName ?? 'Imported Flashcards';
        const { data: newDeck, error } = await supabase
          .from('flashcard_decks')
          .insert({ name: deckName, created_by: ctx.userId, organization_id: ctx.activeOrgId })
          .select('id')
          .single();

        if (error) return toDbFailure(error);
        defaultDeckId = newDeck.id;
      }
    }

    const topicNames = new Set<string>();
    const deckNames = new Set<string>();

    for (const card of data.cards) {
      if (card.topic) topicNames.add(card.topic.trim());
      if (card.deck) deckNames.add(card.deck.trim());
    }

    const topicNameToId = new Map<string, string>();
    const deckNameToId = new Map<string, string>();

    if (topicNames.size > 0) {
      const { data: existingTopics } = await supabase
        .from('topics')
        .select('id, name')
        .in('name', Array.from(topicNames))
        .eq('created_by', ctx.userId);

      for (const t of existingTopics ?? []) {
        topicNameToId.set(t.name.toLowerCase(), t.id);
      }

      const toCreate = Array.from(topicNames).filter(
        (name) => !topicNameToId.has(name.toLowerCase()),
      );

      if (toCreate.length > 0) {
        const { data: newTopics, error } = await supabase
          .from('topics')
          .insert(
            toCreate.map((name) => ({
              name,
              created_by: ctx.userId,
              organization_id: ctx.activeOrgId,
              visibility: 'personal',
            })),
          )
          .select('id, name');

        if (error) return toDbFailure(error);

        for (const t of dbRows(newTopics)) {
          topicNameToId.set(t.name.toLowerCase(), t.id);
        }
      }
    }

    if (deckNames.size > 0) {
      const { data: existingDecks } = await supabase
        .from('flashcard_decks')
        .select('id, name')
        .in('name', Array.from(deckNames))
        .eq('created_by', ctx.userId);

      for (const d of existingDecks ?? []) {
        deckNameToId.set(d.name.toLowerCase(), d.id);
      }

      const toCreate = Array.from(deckNames).filter(
        (name) => !deckNameToId.has(name.toLowerCase()),
      );

      if (toCreate.length > 0) {
        const { data: newDecks, error } = await supabase
          .from('flashcard_decks')
          .insert(
            toCreate.map((name) => ({
              name,
              description: `Auto-created from CSV import`,
              created_by: ctx.userId,
              organization_id: ctx.activeOrgId,
              visibility: 'personal',
            })),
          )
          .select('id, name');

        if (error) return toDbFailure(error);

        for (const d of dbRows(newDecks)) {
          deckNameToId.set(d.name.toLowerCase(), d.id);
        }
      }
    }

    const allDeckIds = defaultDeckId ? [defaultDeckId] : [];
    for (const deckName of deckNames) {
      const id = deckNameToId.get(deckName.toLowerCase());
      if (id) allDeckIds.push(id);
    }

    const allDeckId = allDeckIds.length > 0 ? allDeckIds[0] : null;
    // `flashcards.deck_id` is NOT NULL: every import path above resolves or
    // creates a deck, so a missing one is an internal inconsistency.
    if (!allDeckId) return failure('INTERNAL_SERVER');

    const cardsToInsert: Database['public']['Tables']['flashcards']['Insert'][] = data.cards.map(
      (c) => ({
        front: c.front,
        back: c.back,
        created_by: ctx.userId,
        organization_id: ctx.activeOrgId,
        visibility: 'personal',
        deck_id: allDeckId,
      }),
    );

    const { data: flashcards, error: insertError } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select('id');

    if (insertError) return toDbFailure(insertError);

    const inserted = dbRows(flashcards);
    if (inserted.length !== data.cards.length) {
      return failure('INTERNAL_SERVER');
    }

    const topicAssignments: { flashcard_id: string; topic_id: string }[] = [];

    for (const [i, card] of data.cards.entries()) {
      const topicId = card.topic ? topicNameToId.get(card.topic.toLowerCase()) : undefined;
      if (topicId) {
        topicAssignments.push({ flashcard_id: inserted[i]!.id, topic_id: topicId });
      }
    }

    if (topicAssignments.length > 0) {
      const { error: taError } = await supabase
        .from('flashcard_topic_assignments')
        .insert(topicAssignments);

      if (taError) return toDbFailure(taError);
    }

    return success({ imported: inserted.length });
  }
}
export const flashcardImportService = wrapService(
  new FlashcardImportService(createClient),
  'flashcard-import.service',
);
