import { createClient } from '@/lib/supabase/server';
import { AppError } from '@/lib/errors';
import { mapSupabaseError } from '@/lib/supabase-errors';
import { checkPermission, shouldSetUniversityId, Permission } from '@/lib/rbac';
import type { CsvImportInput, CsvImportResult } from '@/server/models';
import type { RequestContext } from '@/lib/request-context';

export class FlashcardImportService {
  async importCsv(data: CsvImportInput, ctx: RequestContext): Promise<CsvImportResult> {
    const supabase = await createClient();

    let defaultDeckId: string | undefined = data.deckId;

    if (data.deckId) {
      const { data: deck } = await supabase
        .from('flashcard_decks')
        .select('*')
        .eq('id', data.deckId)
        .single();

      if (!deck) throw new AppError('NOT_FOUND');
      await checkPermission(ctx, Permission.DECK_UPDATE, deck);
    } else {
      const hasDeckColumn = data.cards.some((c) => c.deck);
      if (!hasDeckColumn) {
        const deckName = data.defaultDeckName ?? 'Imported Flashcards';
        const { data: newDeck, error } = await supabase
          .from('flashcard_decks')
          .insert({ name: deckName, created_by: ctx.userId, organization_id: ctx.activeOrgId })
          .select('id')
          .single();

        if (error) throw mapSupabaseError(error);
        defaultDeckId = newDeck.id;
      }
    }

    const universityId = (await shouldSetUniversityId(ctx, Permission.FLASHCARD_CREATE))
      ? ctx.activeOrgId
      : null;

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
        .from('flashcard_topics')
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
          .from('flashcard_topics')
          .insert(
            toCreate.map((name) => ({
              name,
              created_by: ctx.userId,
              organization_id: universityId,
            })),
          )
          .select('id, name');

        if (error) throw mapSupabaseError(error);

        for (const t of newTopics ?? []) {
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
              organization_id: universityId,
            })),
          )
          .select('id, name');

        if (error) throw mapSupabaseError(error);

        for (const d of newDecks ?? []) {
          deckNameToId.set(d.name.toLowerCase(), d.id);
        }
      }
    }

    const allDeckIds = defaultDeckId ? [defaultDeckId] : [];
    for (const deckName of deckNames) {
      const id = deckNameToId.get(deckName.toLowerCase());
      if (id) allDeckIds.push(id);
    }

    const cardsToInsert = data.cards.map((c) => ({
      front: c.front,
      back: c.back,
      created_by: ctx.userId,
      organization_id: universityId,
    }));

    const { data: flashcards, error: insertError } = await supabase
      .from('flashcards')
      .insert(cardsToInsert)
      .select('id');

    if (insertError) throw mapSupabaseError(insertError);

    const errors: { row: number; error: string }[] = [];

    if (!flashcards || flashcards.length === 0) {
      throw new AppError('INTERNAL_SERVER');
    }

    const deckAssignments: { flashcard_id: string; deck_id: string }[] = [];
    const topicAssignments: { flashcard_id: string; topic_id: string }[] = [];

    for (let i = 0; i < data.cards.length; i++) {
      const card = data.cards[i];
      const flashcardId = flashcards[i]?.id;

      if (!flashcardId) {
        errors.push({ row: i + 1, error: 'Failed to create flashcard' });
        continue;
      }

      if (defaultDeckId) {
        deckAssignments.push({ flashcard_id: flashcardId, deck_id: defaultDeckId });
      }

      if (card.deck) {
        const deckId = deckNameToId.get(card.deck.toLowerCase());
        if (deckId) {
          deckAssignments.push({ flashcard_id: flashcardId, deck_id: deckId });
        }
      }

      if (card.topic) {
        const topicId = topicNameToId.get(card.topic.toLowerCase());
        if (topicId) {
          topicAssignments.push({ flashcard_id: flashcardId, topic_id: topicId });
        }
      }
    }

    if (deckAssignments.length > 0) {
      const { error: daError } = await supabase
        .from('flashcard_deck_assignments')
        .insert(deckAssignments);

      if (daError) throw mapSupabaseError(daError);
    }

    if (topicAssignments.length > 0) {
      const { error: taError } = await supabase
        .from('flashcard_topic_assignments')
        .insert(topicAssignments);

      if (taError) throw mapSupabaseError(taError);
    }

    return {
      total: data.cards.length,
      imported: data.cards.length - errors.length,
      errors,
    };
  }
}

export const flashcardImportService = new FlashcardImportService();
