import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { flashcardSpacedRepetitionService } from '@/server/services';

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { email, limit = 20 } = await req.json() as { email: string; limit?: number };

  const supabase = createServiceClient();

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, university_id')
    .eq('email', email)
    .single();

  if (!profile) {
    return NextResponse.json({ error: `User not found: ${email}` }, { status: 404 });
  }

  let query = supabase
    .from('flashcards')
    .select('id');

  if (profile.university_id) {
    query = query.eq('university_id', profile.university_id);
  }

  const { data: allFlashcards, error: fetchError } = await query;

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!allFlashcards || allFlashcards.length === 0) {
    return NextResponse.json({ updated: 0, cards: 0, errors: ['No flashcards found'] });
  }

  const { data: states } = await supabase
    .from('flashcard_review_state')
    .select('*')
    .eq('user_id', profile.id)
    .in('flashcard_id', allFlashcards.map((f) => f.id));

  const stateByCard = new Map((states ?? []).map((s) => [s.flashcard_id, s]));

  const now = new Date();
  const due: typeof allFlashcards = [];
  const notDue: typeof allFlashcards = [];

  for (const fc of allFlashcards) {
    const state = stateByCard.get(fc.id);
    if (!state || new Date(state.next_review_at) <= now) {
      due.push(fc);
    } else {
      notDue.push(fc);
    }
  }

  let selected: typeof allFlashcards;

  if (due.length >= limit) {
    selected = shuffle(due).slice(0, limit);
  } else if (due.length > 0) {
    notDue.sort((a, b) => {
      const sa = stateByCard.get(a.id);
      const sb = stateByCard.get(b.id);
      const qa = sa?.last_quality ?? 999;
      const qb = sb?.last_quality ?? 999;
      return qa - qb;
    });
    selected = [...shuffle(due), ...notDue.slice(0, limit - due.length)];
  } else {
    notDue.sort((a, b) => {
      const sa = stateByCard.get(a.id);
      const sb = stateByCard.get(b.id);
      const qa = sa?.last_quality ?? 999;
      const qb = sb?.last_quality ?? 999;
      return qa - qb;
    });
    selected = notDue.slice(0, limit);
  }

  let updated = 0;
  const errors: string[] = [];

  for (const fc of selected) {
    const rand = Math.random();
    let confidenceLevel: number;
    if (rand < 0.10) confidenceLevel = 1;
    else if (rand < 0.25) confidenceLevel = 2;
    else if (rand < 0.55) confidenceLevel = 3;
    else if (rand < 0.80) confidenceLevel = 4;
    else confidenceLevel = 5;

    const wasCorrect = confidenceLevel >= 3;

    const { error: practiceError } = await supabase
      .from('flashcard_practice')
      .insert({
        user_id: profile.id,
        flashcard_id: fc.id,
        was_correct: wasCorrect,
        confidence_level: confidenceLevel,
      });

    if (practiceError) {
      errors.push(`practice ${fc.id}: ${practiceError.message}`);
      continue;
    }

    const existingState = stateByCard.get(fc.id);

    const result = flashcardSpacedRepetitionService.calculateNextReview({
      wasCorrect,
      confidenceLevel,
      currentEF: existingState?.easiness_factor ?? 2.5,
      currentInterval: existingState?.interval_days ?? 0,
      currentRepetitions: existingState?.repetitions ?? 0,
    });

    const quality = flashcardSpacedRepetitionService.mapToQuality(wasCorrect, confidenceLevel);

    const { error: reviewError } = await supabase
      .from('flashcard_review_state')
      .upsert({
        user_id: profile.id,
        flashcard_id: fc.id,
        easiness_factor: result.newEF,
        interval_days: result.newInterval,
        repetitions: result.newRepetitions,
        next_review_at: result.nextReviewAt.toISOString(),
        last_reviewed_at: now.toISOString(),
        last_quality: quality,
      }, {
        onConflict: 'user_id, flashcard_id',
      });

    if (reviewError) {
      errors.push(`review ${fc.id}: ${reviewError.message}`);
      continue;
    }

    updated++;
  }

  return NextResponse.json({
    updated,
    cards: selected.length,
    ...(errors.length > 0 && { errors }),
  });
}
