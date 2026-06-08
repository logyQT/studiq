'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Play, FolderOpen, Tags } from 'lucide-react';

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface FlashcardsClientProps {
  topics: Topic[];
  decks: Deck[];
}

export default function FlashcardsClient({ topics, decks }: FlashcardsClientProps) {
  const t = useTranslations('AppFlashcardsClient');
  const router = useRouter();

  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedDecks, setSelectedDecks] = useState<string[]>([]);
  const [mode, setMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);
  const [dueCount, setDueCount] = useState<number | null>(null);

  const fetchDueCount = useCallback(async (topicIds: string[], deckIds: string[]) => {
    if (topicIds.length === 0 && deckIds.length === 0) {
      setDueCount(null);
      return;
    }
    const params = new URLSearchParams();
    if (topicIds.length > 0) params.set('topicIds', topicIds.join(','));
    if (deckIds.length > 0) params.set('deckIds', deckIds.join(','));
    try {
      const res = await fetch(`/api/v1/flashcards/practice/due/count?${params.toString()}`);
      if (res.ok) {
        const body = await res.json();
        setDueCount(body.data?.count ?? null);
      }
    } catch {
      setDueCount(null);
    }
  }, []);

  useEffect(() => {
    fetchDueCount(selectedTopics, selectedDecks);
  }, [selectedTopics, selectedDecks, fetchDueCount]);

  function toggleTopic(id: string) {
    setSelectedTopics((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  }

  function toggleDeck(id: string) {
    setSelectedDecks((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  }

  function startSession() {
    if (selectedTopics.length === 0 && selectedDecks.length === 0) return;

    const params = new URLSearchParams();
    if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
    if (selectedDecks.length > 0) params.set('decks', selectedDecks.join(','));
    params.set('mode', mode);
    if (mode === 'limited') params.set('target', String(targetCount));

    router.push(`/app/flashcards/session?${params.toString()}`);
  }

  const totalCards =
    topics
      .filter((t) => selectedTopics.includes(t.id))
      .reduce((sum, t) => sum + t.flashcard_count, 0) +
    decks
      .filter((d) => selectedDecks.includes(d.id))
      .reduce((sum, d) => sum + d.flashcard_count, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <Link href="/app/flashcards/decks">
          <Button variant="outline">
            <FolderOpen className="mr-2 h-4 w-4" /> {t('manage_decks')}
          </Button>
        </Link>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5" /> {t('topics_title')}
            </CardTitle>
            <CardDescription>{t('topics_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {topics.map((topic) => (
                <div key={topic.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <Checkbox
                    checked={selectedTopics.includes(topic.id)}
                    onCheckedChange={() => toggleTopic(topic.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{topic.name}</p>
                    <p className="text-xs text-muted-foreground">{t('cards_count', { count: topic.flashcard_count })}</p>
                  </div>
                </div>
              ))}
              {topics.length === 0 && (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  {t('no_topics')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5" /> {t('decks_title')}
            </CardTitle>
            <CardDescription>{t('decks_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {decks.map((deck) => (
                <div key={deck.id} className="flex items-center gap-3 p-3 rounded-lg border">
                  <Checkbox
                    checked={selectedDecks.includes(deck.id)}
                    onCheckedChange={() => toggleDeck(deck.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium">{deck.name}</p>
                    <p className="text-xs text-muted-foreground">{t('cards_count', { count: deck.flashcard_count })}</p>
                  </div>
                </div>
              ))}
              {decks.length === 0 && (
                <p className="text-center py-4 text-muted-foreground text-sm">
                  {t('no_decks')}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('practice_mode_title')}</CardTitle>
          <CardDescription>{t('practice_mode_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <button
              className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                mode === 'endless' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onClick={() => setMode('endless')}
            >
              <p className="font-medium">{t('mode_endless')}</p>
              <p className="text-sm text-muted-foreground">{t('mode_endless_desc')}</p>
            </button>
            <button
              className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                mode === 'limited' ? 'border-primary bg-primary/5' : 'border-border'
              }`}
              onClick={() => setMode('limited')}
            >
              <p className="font-medium">{t('mode_limited')}</p>
              <p className="text-sm text-muted-foreground">{t('mode_limited_desc')}</p>
            </button>
          </div>

          {mode === 'limited' && (
            <div>
              <Label>{t('target_count_label', { count: targetCount })}</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={targetCount}
                onChange={(e) =>
                  setTargetCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))
                }
                className="mt-2 max-w-32"
              />
            </div>
          )}

          <div className="flex items-center justify-between pt-2">
            <div className="text-sm text-muted-foreground">
              {selectedTopics.length + selectedDecks.length === 0 ? (
                t('select_to_start')
              ) : (
                <>
                  <span>{t('cards_available', { count: totalCards })}</span>
                  {dueCount !== null && (
                    <span className="ml-2 font-medium text-foreground">
                      ({dueCount} {t('due_for_review')})
                    </span>
                  )}
                </>
              )}
            </div>
            <Button
              onClick={startSession}
              disabled={selectedTopics.length === 0 && selectedDecks.length === 0}
            >
              <Play className="mr-2 h-4 w-4" /> {t('start_practice')}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
