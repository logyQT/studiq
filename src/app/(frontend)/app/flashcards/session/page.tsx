'use client';

import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Check, X, ArrowLeft, RotateCcw, Minus, Zap } from 'lucide-react';
import { toast } from 'sonner';

interface Flashcard {
  id: string;
  front: string;
  back: string;
  reviewState: {
    easiness_factor: number;
    interval_days: number;
    repetitions: number;
    next_review_at: string;
    last_reviewed_at: string | null;
    last_quality: number | null;
  } | null;
}

interface DueResponse {
  id: string;
  front: string;
  back: string;
  reviewState: Flashcard['reviewState'];
}

const BATCH_SIZE = 20;
const REFILL_THRESHOLD = 5;

function generateUUID(): string {
  return crypto.randomUUID();
}

export default function FlashcardSessionPage() {
  const t = useTranslations('AppFlashcardSessionPage');
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = searchParams.get('mode') as 'endless' | 'limited' | 'quick' | null;
  const isQuick = mode === 'quick';
  const targetCount = parseInt(searchParams.get('target') || '10');
  const effectiveBatchSize = isQuick ? parseInt(searchParams.get('limit') || '5', 10) : BATCH_SIZE;
  const topicsStr = searchParams.get('topics');
  const decksStr = searchParams.get('decks');
  const topicIds = useMemo(() => topicsStr?.split(',').filter(Boolean) ?? [], [topicsStr]);
  const deckIds = useMemo(() => decksStr?.split(',').filter(Boolean) ?? [], [decksStr]);

  const sessionIdRef = useRef<string>('');
  const processingRef = useRef(false);

  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [allCaughtUp, setAllCaughtUp] = useState(false);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    sessionIdRef.current = generateUUID();
  }, []);

  const buildDueParams = useCallback(() => {
    const params = new URLSearchParams();
    if (topicIds.length > 0) params.set('topicIds', topicIds.join(','));
    if (deckIds.length > 0) params.set('deckIds', deckIds.join(','));
    params.set('limit', String(effectiveBatchSize));
    return params.toString();
  }, [topicIds, deckIds, effectiveBatchSize]);

  const fetchDueCards = useCallback(async (): Promise<Flashcard[]> => {
    try {
      const res = await fetch(`/api/v1/flashcards/practice/due?${buildDueParams()}`);
      if (!res.ok) return [];
      const body = await res.json();
      return (body.data ?? []).map((card: DueResponse) => ({
        id: card.id,
        front: card.front,
        back: card.back,
        reviewState: card.reviewState,
      }));
    } catch {
      return [];
    }
  }, [buildDueParams]);

  useEffect(() => {
    if (!isQuick && topicIds.length === 0 && deckIds.length === 0) {
      router.push('/app/flashcards');
      return;
    }

    fetchDueCards().then((cards) => {
      if (cards.length === 0) {
        toast.error(t('no_flashcards_found'));
        router.push(isQuick ? '/app' : '/app/flashcards');
        return;
      }
      setQueue(cards);
      setHasMore(cards.length >= effectiveBatchSize && !isQuick);
      setLoading(false);
    });
  }, [topicIds, deckIds, router, t, fetchDueCards, isQuick, effectiveBatchSize]);

  const refillQueue = useCallback(async () => {
    if (!hasMore) return;
    const moreCards = await fetchDueCards();
    if (moreCards.length === 0) {
      setHasMore(false);
      return;
    }
    setQueue((prev) => {
      const existingIds = new Set(prev.map((c) => c.id));
      const unique = moreCards.filter((c) => !existingIds.has(c.id));
      return [...prev, ...unique];
    });
    if (moreCards.length < effectiveBatchSize) {
      setHasMore(false);
    }
  }, [fetchDueCards, hasMore, effectiveBatchSize]);

  const handleAnswer = useCallback(
    async (wasCorrect: boolean, confidenceLevel: number) => {
      if (processingRef.current) return;
      processingRef.current = true;
      try {
        const card = queue[currentIndex];
        if (!card) return;

        const body: Record<string, unknown> = { wasCorrect, confidenceLevel, sessionId: sessionIdRef.current };
        try {
          await fetch(`/api/v1/flashcards/${card.id}/practice`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
        } catch {
          // silent fail - practice still logged on next attempts
        }

        setTotalAnswered((prev) => prev + 1);
        if (wasCorrect) {
          setCorrectCount((prev) => prev + 1);
        }

        if (mode === 'limited' && correctCount + (wasCorrect ? 1 : 0) >= targetCount) {
          setSessionComplete(true);
          return;
        }

        const nextIndex = currentIndex + 1;
        if (nextIndex >= queue.length) {
          if (hasMore) {
            const moreCards = await fetchDueCards();
            if (moreCards.length === 0) {
              setHasMore(false);
              if (mode === 'endless') {
                setAllCaughtUp(true);
              } else {
                setSessionComplete(true);
              }
              return;
            }
            setQueue(moreCards);
            setHasMore(moreCards.length >= effectiveBatchSize && !isQuick);
            setCurrentIndex(0);
          } else {
            if (mode === 'endless') {
              setAllCaughtUp(true);
            } else {
              setSessionComplete(true);
            }
            return;
          }
        } else {
          setCurrentIndex(nextIndex);
        }
        setFlipped(false);

        if (queue.length - nextIndex <= REFILL_THRESHOLD) {
          refillQueue();
        }
      } finally {
        processingRef.current = false;
      }
    },
    [queue, currentIndex, correctCount, mode, targetCount, hasMore, fetchDueCards, refillQueue, isQuick, effectiveBatchSize],
  );

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  if (allCaughtUp) {
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t('all_caught_up')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-center space-y-4">
            <p className="text-lg">{t('no_due_cards_message')}</p>
            <p className="text-sm text-muted-foreground">
              {t('session_result', { correct: correctCount, total: totalAnswered })}
            </p>
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            <Link href={isQuick ? '/app' : '/app/flashcards/practice'}>
              <Button>
                <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_to_setup')}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (sessionComplete) {
    const percentage = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">{t('session_complete_title')}</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-center space-y-4">
            <p
              className="text-5xl font-bold"
              style={{ color: percentage >= 70 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))' }}
            >
              {percentage}%
            </p>
            <p className="text-lg">
              {t('session_result', { correct: correctCount, total: totalAnswered })}
            </p>
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            <Button
              variant="outline"
              onClick={() => {
                setCorrectCount(0);
                setTotalAnswered(0);
                setSessionComplete(false);
                setCurrentIndex(0);
                setFlipped(false);
                setHasMore(true);
                setAllCaughtUp(false);
                sessionIdRef.current = generateUUID();
                fetchDueCards().then((cards) => {
                  setQueue(cards);
                  setHasMore(cards.length >= effectiveBatchSize && !isQuick);
                });
              }}
            >
              <RotateCcw className="mr-2 h-4 w-4" /> {t('practice_again')}
            </Button>
            <Link href={isQuick ? '/app' : '/app/flashcards/practice'}>
              <Button>
                <ArrowLeft className="mr-2 h-4 w-4" /> {t('back_to_setup')}
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (queue.length === 0) {
    return <div className="flex justify-center py-12">{t('no_flashcards_available')}</div>;
  }

  const current = queue[currentIndex];
  const progress = mode === 'limited' ? (correctCount / targetCount) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link href={isQuick ? '/app' : '/app/flashcards'}>
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('exit_session')}
          </Button>
        </Link>
        <div className="flex items-center gap-4">
          <Badge variant="outline">
            {t('correct_badge', { correct: correctCount, total: totalAnswered })}
          </Badge>
          {mode === 'limited' && (
            <Badge>
              {t('remembered_badge', { correct: correctCount, target: targetCount })}
            </Badge>
          )}
        </div>
      </div>

      {mode === 'limited' && <Progress value={progress} />}

      <Card
        className="cursor-pointer min-h-64 flex items-center justify-center transition-all duration-300 hover:shadow-lg"
        onClick={() => setFlipped(!flipped)}
      >
        <CardContent className="pt-8 text-center px-8">
          <p className="text-xs text-muted-foreground uppercase mb-4">
            {flipped ? t('answer_label') : t('question_label')}
          </p>
          <p className="text-2xl font-medium">{flipped ? current.back : current.front}</p>
          <p className="text-sm text-muted-foreground mt-4">
            {t('click_hint', { action: flipped ? t('see_question') : t('reveal_answer') })}
          </p>
        </CardContent>
      </Card>

      {flipped && (
        <div className="grid grid-cols-2 gap-2">
          <Button onClick={() => handleAnswer(false, 1)}>
            <X className="mr-1.5 h-4 w-4 text-red-500" /> {t('rating_again')}
          </Button>
          <Button onClick={() => handleAnswer(false, 3)}>
            <Minus className="mr-1.5 h-4 w-4 text-orange-500" /> {t('rating_hard')}
          </Button>
          <Button onClick={() => handleAnswer(true, 3)}>
            <Check className="mr-1.5 h-4 w-4 text-amber-500" /> {t('rating_good')}
          </Button>
          <Button onClick={() => handleAnswer(true, 5)}>
            <Zap className="mr-1.5 h-4 w-4 text-green-500" /> {t('rating_easy')}
          </Button>
        </div>
      )}
    </div>
  );
}
