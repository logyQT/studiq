'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Play } from 'lucide-react';

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
  'from-red-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500',
  'from-teal-500 to-emerald-600',
];

function getGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface PracticeClientProps {
  decks: Deck[];
}

export default function PracticeClient({ decks }: PracticeClientProps) {
  const t = useTranslations('AppFlashcardPracticePage');
  const router = useRouter();

  function startPractice(deckId: string) {
    router.push(`/app/flashcards/session?mode=practice&deckId=${deckId}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/app/flashcards">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
        <h2 className="text-2xl font-bold">{t('deck_picker_title')}</h2>
      </div>

      <p className="text-muted-foreground">{t('deck_picker_desc')}</p>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {decks.map((deck) => {
          const gradient = getGradient(deck.id);
          return (
            <Card
              key={deck.id}
              className="group overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50"
              onClick={() => startPractice(deck.id)}
            >
              <div className={`h-20 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
                <span className="text-2xl font-bold text-white/90">{deck.name.charAt(0).toUpperCase()}</span>
              </div>
              <CardHeader className="pb-2">
                <CardTitle className="text-lg truncate">{deck.name}</CardTitle>
                {deck.description && (
                  <CardDescription className="line-clamp-2">{deck.description}</CardDescription>
                )}
              </CardHeader>
              <CardContent className="flex items-center justify-between pt-0">
                <Badge variant="secondary">{t('flashcards_count', { count: deck.flashcard_count })}</Badge>
                <Button variant="ghost" size="sm" className="gap-1">
                  <Play className="h-3 w-3" /> {t('start_practice')}
                </Button>
              </CardContent>
            </Card>
          );
        })}
        {decks.length === 0 && (
          <div className="col-span-full text-center py-12 text-muted-foreground">
            {t('no_decks_picker')}
          </div>
        )}
      </div>
    </div>
  );
}
