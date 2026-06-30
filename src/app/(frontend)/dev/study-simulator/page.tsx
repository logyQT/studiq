'use client';

import { AlertCircle, CheckCircle2, Loader2, Play } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

const STUDENTS = [
  { email: 'e2e-student1@test.local', short: 'S1' },
  { email: 'e2e-student2@test.local', short: 'S2' },
  { email: 'e2e-student3@test.local', short: 'S3' },
  { email: 'e2e-student4@test.local', short: 'S4' },
  { email: 'e2e-student5@test.local', short: 'S5' },
];

interface StudentResult {
  status: 'idle' | 'loading' | 'done' | 'error';
  updated?: number;
  cards?: number;
  error?: string;
}

export default function StudySimulatorPage() {
  const [count, setCount] = useState(20);
  const [results, setResults] = useState<Record<string, StudentResult>>(
    Object.fromEntries(STUDENTS.map((s) => [s.email, { status: 'idle' }])),
  );
  const [startedAt, setStartedAt] = useState<number | null>(null);

  const totals = Object.values(results).reduce(
    (acc, r) => {
      if (r.status === 'done') {
        acc.done++;
        acc.practices += r.updated ?? 0;
      }
      return acc;
    },
    { done: 0, practices: 0 },
  );

  const simulate = useCallback(
    async (email: string) => {
      setResults((prev) => ({ ...prev, [email]: { status: 'loading' } }));
      try {
        const res = await fetch('/api/v1/dev/study-simulate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, limit: count }),
        });
        const data = await res.json();
        if (!res.ok) {
          setResults((prev) => ({
            ...prev,
            [email]: { status: 'error', error: data.error },
          }));
        } else {
          setResults((prev) => ({
            ...prev,
            [email]: { status: 'done', updated: data.updated, cards: data.cards },
          }));
        }
      } catch (err) {
        setResults((prev) => ({
          ...prev,
          [email]: { status: 'error', error: String(err) },
        }));
      }
    },
    [count],
  );

  const simulateAll = useCallback(async () => {
    setStartedAt(Date.now());
    for (const student of STUDENTS) {
      await simulate(student.email);
    }
    setStartedAt(null);
  }, [simulate]);

  const statusIcon = (r: StudentResult) => {
    switch (r.status) {
      case 'loading':
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case 'done':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return null;
    }
  };

  if (process.env.NODE_ENV !== 'development') {
    return (
      <div className="p-8 text-center text-muted-foreground">Only available in development</div>
    );
  }

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Study Simulator</h1>
            <p className="text-sm text-muted-foreground">
              Simulate students studying flashcards. Open{' '}
              <code className="rounded bg-muted px-1 py-0.5 text-xs font-mono">
                /edu/flashcards/stats
              </code>{' '}
              in another tab to watch realtime updates.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label htmlFor="count" className="text-sm text-muted-foreground whitespace-nowrap">
                Cards per student:
              </label>
              <Input
                id="count"
                type="number"
                min={1}
                max={100}
                value={count}
                onChange={(e) => setCount(Number(e.target.value))}
                className="w-20 h-8"
              />
            </div>
            <Button onClick={simulateAll} size="sm" disabled={startedAt !== null}>
              <Play className="mr-1.5 h-4 w-4" />
              Simulate All
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-3">
          {STUDENTS.map((student) => {
            const r = results[student.email];
            const isLoading = r.status === 'loading';
            return (
              <Card
                key={student.email}
                className={cn(
                  'transition-shadow',
                  r.status === 'done' && 'border-green-200 dark:border-green-800',
                  r.status === 'error' && 'border-destructive/50',
                )}
              >
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-xs font-mono truncate">{student.short}</CardTitle>
                    {statusIcon(r)}
                  </div>
                  <CardDescription className="text-[10px] truncate">
                    {student.email}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {r.status === 'done' ? (
                    <div className="space-y-1">
                      <p className="text-lg font-bold tabular-nums">{r.updated}</p>
                      <p className="text-xs text-muted-foreground">practices on {r.cards} cards</p>
                    </div>
                  ) : r.status === 'error' ? (
                    <p className="text-xs text-destructive">{r.error}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {r.status === 'loading' ? 'Simulating...' : 'Ready'}
                    </p>
                  )}
                  <Button
                    variant={r.status === 'done' ? 'outline' : 'secondary'}
                    size="sm"
                    className="w-full text-xs h-7"
                    disabled={isLoading || startedAt !== null}
                    onClick={() => simulate(student.email)}
                  >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-1 h-3 w-3 animate-spin" /> Studying...
                      </>
                    ) : (
                      <>
                        <Play className="mr-1 h-3 w-3" /> Study {count}
                      </>
                    )}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>

        {totals.done > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Session Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex gap-6 text-sm">
                <div>
                  <span className="text-muted-foreground">Students done: </span>
                  <span className="font-bold">{totals.done} / 5</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Total practices: </span>
                  <span className="font-bold tabular-nums">{totals.practices}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
