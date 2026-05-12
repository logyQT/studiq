'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Check, X, ArrowLeft, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

export default function FlashcardSessionPage() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const mode = searchParams.get('mode') as 'endless' | 'limited' | null;
  const targetCount = parseInt(searchParams.get('target') || '10');

  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [correctCount, setCorrectCount] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [sessionComplete, setSessionComplete] = useState(false);

  useEffect(() => {
    const topicIds = searchParams.get('topics')?.split(',').filter(Boolean) ?? [];
    const spaceIds = searchParams.get('spaces')?.split(',').filter(Boolean) ?? [];

    if (topicIds.length === 0 && spaceIds.length === 0) {
      router.push('/app/flashcards');
      return;
    }

    const params = new URLSearchParams();
    if (topicIds.length > 0) params.set('topicIds', topicIds.join(','));
    if (spaceIds.length > 0) params.set('spaceIds', spaceIds.join(','));

    fetch(`/api/v1/flashcards?${params.toString()}`)
      .then((r) => r.ok ? r.json() : [])
      .then((data) => {
        if (data.length === 0) {
          toast.error('No flashcards found for selected topics/spaces');
          router.push('/app/flashcards');
          return;
        }
        const shuffled = [...data].sort(() => Math.random() - 0.5);
        setFlashcards(shuffled);
        setLoading(false);
      })
      .catch(() => {
        toast.error('Failed to load flashcards');
        setLoading(false);
      });
  }, [searchParams, router]);

  const handleAnswer = useCallback((wasCorrect: boolean) => {
    const current = flashcards[currentIndex];
    fetch('/api/v1/flashcard-practice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flashcardId: current.id, wasCorrect }),
    });

    setTotalAnswered((prev) => prev + 1);
    if (wasCorrect) {
      setCorrectCount((prev) => prev + 1);
    }

    if (mode === 'limited' && correctCount + (wasCorrect ? 1 : 0) >= targetCount) {
      setSessionComplete(true);
      return;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= flashcards.length) {
      const reshuffled = [...flashcards].sort(() => Math.random() - 0.5);
      setFlashcards(reshuffled);
      setCurrentIndex(0);
    } else {
      setCurrentIndex(nextIndex);
    }
    setFlipped(false);
  }, [flashcards, currentIndex, correctCount, mode, targetCount]);

  if (loading) return <div className="flex justify-center py-12">Loading...</div>;
  if (flashcards.length === 0) return <div className="flex justify-center py-12">No flashcards available</div>;

  if (sessionComplete) {
    const percentage = totalAnswered > 0 ? Math.round((correctCount / totalAnswered) * 100) : 0;
    return (
      <div className="max-w-2xl mx-auto">
        <Card>
          <CardHeader className="text-center">
            <CardTitle className="text-2xl">Session Complete!</CardTitle>
          </CardHeader>
          <CardContent className="pt-4 text-center space-y-4">
            <p className="text-5xl font-bold" style={{ color: percentage >= 70 ? '#10b981' : '#ef4444' }}>
              {percentage}%
            </p>
            <p className="text-lg">{correctCount} out of {totalAnswered} correct</p>
          </CardContent>
          <CardFooter className="flex justify-center gap-3">
            <Button variant="outline" onClick={() => {
              setCorrectCount(0);
              setTotalAnswered(0);
              setSessionComplete(false);
              setCurrentIndex(0);
              setFlipped(false);
              setFlashcards((prev) => [...prev].sort(() => Math.random() - 0.5));
            }}>
              <RotateCcw className="mr-2 h-4 w-4" /> Practice Again
            </Button>
            <Link href="/app/flashcards">
              <Button>
                <ArrowLeft className="mr-2 h-4 w-4" /> Back to Setup
              </Button>
            </Link>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const current = flashcards[currentIndex];
  const progress = mode === 'limited' ? (correctCount / targetCount) * 100 : 0;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Link href="/app/flashcards">
          <Button variant="outline" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> Exit Session
          </Button>
        </Link>
        <div className="flex items-center gap-4">
          <Badge variant="outline">{correctCount}/{totalAnswered} correct</Badge>
          {mode === 'limited' && (
            <Badge>{correctCount}/{targetCount} remembered</Badge>
          )}
        </div>
      </div>

      {mode === 'limited' && <Progress value={progress} />}

      <Card
        className="cursor-pointer min-h-64 flex items-center justify-center transition-all duration-300 hover:shadow-lg"
        onClick={() => setFlipped(!flipped)}
      >
        <CardContent className="pt-8 text-center px-8">
          <p className="text-xs text-muted-foreground uppercase mb-4">{flipped ? 'Answer' : 'Question'}</p>
          <p className="text-2xl font-medium">{flipped ? current.back : current.front}</p>
          <p className="text-sm text-muted-foreground mt-4">Click to {flipped ? 'see question' : 'reveal answer'}</p>
        </CardContent>
      </Card>

      {flipped && (
        <div className="flex justify-center gap-4">
          <Button variant="outline" className="flex-1 max-w-48" onClick={() => handleAnswer(false)}>
            <X className="mr-2 h-4 w-4 text-red-500" /> Still Learning
          </Button>
          <Button className="flex-1 max-w-48" onClick={() => handleAnswer(true)}>
            <Check className="mr-2 h-4 w-4 text-green-500" /> Got It
          </Button>
        </div>
      )}
    </div>
  );
}
