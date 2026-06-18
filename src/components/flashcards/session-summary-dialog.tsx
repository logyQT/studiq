'use client';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, RotateCcw } from 'lucide-react';

interface SessionSummaryData {
  cardsStudied: number;
  cardsCorrect: number;
  durationMs: number;
  mode: string;
}

interface SessionSummaryDialogProps {
  data: SessionSummaryData;
  onPracticeAgain?: () => void;
  onBackToSetup: () => void;
}

export function SessionSummaryDialog({
  data,
  onPracticeAgain,
  onBackToSetup,
}: SessionSummaryDialogProps) {
  const t = useTranslations('AppFlashcardSessionPage');
  const modeKey = data.mode as 'review' | 'cram' | 'quick';
  const practiceAgainLabel = t(`practice_again_${modeKey}` as const);
  const backLabel = t(`back_${modeKey}` as const);

  const percentage = data.cardsStudied > 0
    ? Math.round((data.cardsCorrect / data.cardsStudied) * 100)
    : 0;

  const totalSeconds = Math.round(data.durationMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  const cardsPerMinute = data.durationMs > 0
    ? ((data.cardsStudied / data.durationMs) * 60_000).toFixed(1)
    : '0';

  return (
    <Dialog open>
      <DialogContent className="sm:max-w-md">
        <DialogHeader className="text-center">
          <DialogTitle className="text-2xl">{t('session_complete_title')}</DialogTitle>
          <DialogDescription>
            {t('session_result', { correct: data.cardsCorrect, total: data.cardsStudied })}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-4">
          <p
            className="text-5xl font-bold"
            style={{ color: percentage >= 70 ? 'hsl(var(--chart-2))' : 'hsl(var(--destructive))' }}
          >
            {percentage}%
          </p>

          <Badge variant="secondary">
            {data.mode === 'cram' ? t('mode_practice') : t('mode_study')}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-4 text-center">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{t('summary_cards_studied')}</p>
            <p className="text-xl font-semibold">{data.cardsCorrect}/{data.cardsStudied}</p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">{t('summary_duration')}</p>
            <p className="text-xl font-semibold">{minutes}:{seconds.toString().padStart(2, '0')}</p>
          </div>
          <div className="rounded-lg border p-3 col-span-2">
            <p className="text-xs text-muted-foreground">{t('summary_cards_per_minute')}</p>
            <p className="text-xl font-semibold">{cardsPerMinute}</p>
          </div>
        </div>

        <DialogFooter className="flex justify-center gap-3 sm:justify-center">
          {onPracticeAgain && (
            <Button variant="outline" onClick={onPracticeAgain}>
              <RotateCcw className="mr-2 h-4 w-4" /> {practiceAgainLabel}
            </Button>
          )}
          <Button onClick={onBackToSetup}>
            <ArrowLeft className="mr-2 h-4 w-4" /> {backLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
