'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Play, CheckCircle2, XCircle, ListRestart } from 'lucide-react';
import { apiPost } from '@/lib/api';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';

type TimelineKind = 'api' | 'event' | 'fetch' | 'verdict';

interface TimelineEntry {
  time: string;
  label: string;
  kind: TimelineKind;
}

export function SimulatorClient() {
  const [cardCount, setCardCount] = useState(50);
  const [deckName, setDeckName] = useState('Dev Test Deck');
  const [running, setRunning] = useState(false);
  const [eventCounts, setEventCounts] = useState<Record<string, number>>({});
  const [networkFetches, setNetworkFetches] = useState(0);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [verdict, setVerdict] = useState<'pass' | 'fail' | null>(null);

  const eventCountsRef = useRef(eventCounts);
  const networkFetchesRef = useRef(networkFetches);
  useEffect(() => { eventCountsRef.current = eventCounts; }, [eventCounts]);
  useEffect(() => { networkFetchesRef.current = networkFetches; }, [networkFetches]);

  const addTimeline = useCallback((kind: TimelineKind, label: string) => {
    setTimeline((prev) => [...prev, { time: new Date().toISOString().slice(11, 23), label, kind }]);
  }, []);

  useRealtimeChannel(
    channel('flashcard-simulator')
      .listen('flashcard_decks', () => {
        setEventCounts((prev) => ({ ...prev, deck: (prev.deck ?? 0) + 1 }));
        addTimeline('event', 'event: flashcard_decks');
      })
      .listen('flashcards', () => {
        setEventCounts((prev) => ({ ...prev, card: (prev.card ?? 0) + 1 }));
        addTimeline('event', 'event: flashcards');
      })
      .listen('flashcard_deck_assignments', () => {
        setEventCounts((prev) => ({ ...prev, assignment: (prev.assignment ?? 0) + 1 }));
        addTimeline('event', 'event: flashcard_deck_assignments');
      }),
  );

  useEffect(() => {
    if (!running) return;
    const origFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const method = init?.method ?? 'GET';
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (method === 'GET' && (url as string).includes('/api/v1/flashcards')) {
        setNetworkFetches((prev) => prev + 1);
        addTimeline('fetch', `GET ${url}`);
      }
      return origFetch(input, init);
    };
    return () => {
      window.fetch = origFetch;
    };
  }, [running, addTimeline]);

  const handleSimulate = useCallback(async () => {
    setRunning(true);
    setEventCounts({});
    setNetworkFetches(0);
    setTimeline([]);
    setVerdict(null);

    try {
      addTimeline('api', `Creating deck "${deckName}"...`);
      const { id: deckId } = await apiPost<{ id: string }>(
        '/api/v1/flashcards/decks',
        { name: deckName },
      );
      addTimeline('api', `Deck created: ${deckId}`);

      const cards = Array.from({ length: cardCount }, (_, i) => ({
        front: `Test card ${i + 1} — what is the meaning of ${i}?`,
        back: `Card ${i + 1} answer — demonstrating debounce behavior.`,
      }));
      addTimeline('api', `Saving ${cardCount} cards...`);
      await apiPost('/api/v1/flashcards/batch/create', {
        cards,
        deckIds: [deckId],
      });
      addTimeline('api', `Batch saved ${cardCount} cards`);

      setTimeout(() => {
        const ev =
          (eventCountsRef.current.deck ?? 0) +
          (eventCountsRef.current.card ?? 0) +
          (eventCountsRef.current.assignment ?? 0);
        const nf = networkFetchesRef.current;
        setVerdict(nf < 10 ? 'pass' : 'fail');
        addTimeline('verdict', `VERDICT: ${nf} network fetches for ${ev} events`);
        setRunning(false);
      }, 6000);
    } catch (err) {
      addTimeline('api', `ERROR: ${err instanceof Error ? err.message : String(err)}`);
      setRunning(false);
    }
  }, [cardCount, deckName, addTimeline]);

  const totalEvents =
    (eventCounts.deck ?? 0) + (eventCounts.card ?? 0) + (eventCounts.assignment ?? 0);

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Flashcard Save Simulator
            </h1>
            <p className="text-sm text-muted-foreground">
              Simulates the agent saving flashcards to a deck. Verifies the realtime debounce
              coalesces N Supabase events into 1&ndash;2 re-fetches.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setEventCounts({});
                setNetworkFetches(0);
                setTimeline([]);
                setVerdict(null);
              }}
              disabled={running}
            >
              <ListRestart className="mr-1.5 h-4 w-4" />
              Reset
            </Button>
          </div>
        </div>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-end gap-4 flex-wrap">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Card count</label>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={cardCount}
                  onChange={(e) => setCardCount(Number(e.target.value))}
                  className="w-24 h-9"
                />
              </div>
              <div className="space-y-1.5 flex-1 min-w-[200px]">
                <label className="text-sm font-medium">Deck name</label>
                <Input
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  className="h-9"
                />
              </div>
              <Button onClick={handleSimulate} disabled={running}>
                {running ? (
                  <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Simulating...</>
                ) : (
                  <><Play className="mr-1.5 h-4 w-4" /> Simulate Agent Save</>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Realtime Events
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{totalEvents}</p>
              <div className="mt-1 flex gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-xs">
                  decks: {eventCounts.deck ?? 0}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  cards: {eventCounts.card ?? 0}
                </Badge>
                <Badge variant="outline" className="text-xs">
                  assignments: {eventCounts.assignment ?? 0}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Network Fetches
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums">{networkFetches}</p>
              <p className="text-xs text-muted-foreground mt-1">
                GET requests to /api/v1/flashcards/*
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Expected (w/ debounce)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-bold tabular-nums text-green-600 dark:text-green-400">
                ~2&ndash;4
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                vs {totalEvents} raw events
              </p>
            </CardContent>
          </Card>
        </div>

        {verdict && (
          <Card
            className={
              verdict === 'pass'
                ? 'border-green-400 dark:border-green-700'
                : 'border-destructive'
            }
          >
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                {verdict === 'pass' ? (
                  <CheckCircle2 className="h-6 w-6 text-green-500 shrink-0" />
                ) : (
                  <XCircle className="h-6 w-6 text-destructive shrink-0" />
                )}
                <div>
                  <p className="font-semibold">
                    {verdict === 'pass'
                      ? 'Debounce working correctly'
                      : 'Debounce may not be working'}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {networkFetches} network fetches for {totalEvents} events —{' '}
                    {verdict === 'pass'
                      ? 'coalesced down to &lt;10 (expected 2–4)'
                      : 'expected &lt;10, check use-flashcard-realtime.ts'}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Timeline</CardTitle>
              <span className="text-xs text-muted-foreground">
                {timeline.length} entries
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-64 overflow-y-auto font-mono text-xs space-y-0.5">
              {timeline.length === 0 ? (
                <p className="text-muted-foreground italic">
                  Run a simulation to see the timeline...
                </p>
              ) : (
                timeline.map((entry, i) => (
                  <div
                    key={i}
                    className={
                      entry.kind === 'api'
                        ? 'text-blue-600 dark:text-blue-400'
                        : entry.kind === 'event'
                          ? 'text-amber-600 dark:text-amber-400'
                          : entry.kind === 'fetch'
                            ? 'text-green-600 dark:text-green-400'
                            : 'text-foreground font-bold'
                    }
                  >
                    <span className="text-muted-foreground">{entry.time}</span>{' '}
                    {entry.label}
                  </div>
                ))
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
