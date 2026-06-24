'use client';

import { useState } from 'react';
import { FlashcardBlock, FlashcardGenerationStatus } from '@/components/ai';

const SAMPLE_FLASHCARDS = [
  { front: 'What is the capital of France?', back: 'Paris', topic: 'Geography' },
  { front: 'What is 2 + 2?', back: '4', topic: 'Math' },
  { front: 'What is the chemical symbol for water?', back: 'H₂O', topic: 'Chemistry' },
  { front: 'Who wrote Romeo and Juliet?', back: 'William Shakespeare', topic: 'Literature' },
  { front: 'What is the speed of light?', back: '~300,000 km/s', topic: 'Physics' },
  { front: 'What year did WW2 end?', back: '1945', topic: 'History' },
];

function ImprovedSkeleton({ count }: { count: number }) {
  return (
    <div className="w-full min-w-[400px] space-y-3 mt-2 animate-pulse">
      {/* Header — Layers icon + label, Pencil icon + Input */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="h-3.5 w-3.5 rounded bg-muted shrink-0" />
          <div className="h-3 w-2/3 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded bg-muted shrink-0" />
          <div className="h-7 flex-1 rounded bg-muted" />
        </div>
      </div>

      {/* Grid wrapper matching rendered max-h + scroll + padding */}
      <div className="max-h-[28rem] overflow-y-auto -mx-1 px-1">
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: count }).map((_, i) => (
            <div key={i} className="rounded-lg border bg-background/60 p-2.5">
              <div className="space-y-0.5">
                <div className="h-4 w-3/4 rounded bg-muted" />
                <div className="h-4 w-1/2 rounded bg-muted mt-0.5" />
                <div className="h-3.5 w-1/4 rounded bg-muted mt-1" />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="h-8 w-full rounded-md bg-muted" />
    </div>
  );
}

export default function DevAiPage() {
  const [count, setCount] = useState(6);

  return (
    <div className="flex flex-1 flex-col min-h-0 p-6 space-y-6 max-w-3xl mx-auto">
      <div className="space-y-1">
        <h1 className="text-lg font-bold">Flashcard Loading States</h1>
        <p className="text-xs text-muted-foreground">
          Compare original skeleton, improved skeleton, and rendered output — all with animated status.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-xs flex items-center gap-1">
          Count:
          <input
            type="number"
            min={1}
            max={20}
            value={count}
            onChange={(e) => setCount(Number(e.target.value) || 6)}
            className="w-14 h-7 text-xs rounded border bg-background px-1.5"
          />
        </label>
      </div>

      <div className="mx-auto max-w-3xl px-4 space-y-6">
        {/* Original skeleton */}
        <div className="flex justify-start">
          <div className="max-w-[80%] space-y-2 rounded-2xl px-4 py-3 text-sm bg-muted/30 text-foreground rounded-bl-md">
            <FlashcardGenerationStatus status="generating" />
            <div className="w-full"><FlashcardBlock loading count={count} deckName="Dev Test Deck" /></div>
          </div>
        </div>

        {/* Improved skeleton */}
        <div className="flex justify-start">
          <div className="max-w-[80%] space-y-2 rounded-2xl px-4 py-3 text-sm bg-muted/30 text-foreground rounded-bl-md">
            <FlashcardGenerationStatus status="generating" />
            <ImprovedSkeleton count={count} />
          </div>
        </div>

        {/* Rendered output */}
        <div className="flex justify-start">
          <div className="max-w-[80%] space-y-2 rounded-2xl px-4 py-3 text-sm bg-muted/30 text-foreground rounded-bl-md">
            <div className="w-full"><FlashcardBlock
              flashcards={SAMPLE_FLASHCARDS.slice(0, count)}
              deckName="Dev Test Deck"
            /></div>
          </div>
        </div>
      </div>
    </div>
  );
}
