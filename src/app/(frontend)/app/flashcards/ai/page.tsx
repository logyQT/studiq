'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Upload, Trash2, Check, Sparkles, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useGenerateFlashcards } from '@/hooks/use-flashcard-generation';
import type { GeneratedFlashcard } from '@/hooks/use-flashcard-generation';

type CardState = GeneratedFlashcard & { kept: boolean };

export default function AiFlashcardPage() {
  const t = useTranslations('FlashcardAiPage');
  const router = useRouter();
  const { flashcards, suggestedDeckName, progress, status, errorMessage, generate, reset } = useGenerateFlashcards();

  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState('en');
  const [cardStates, setCardStates] = useState<CardState[]>([]);
  const [deckName, setDeckName] = useState('');
  const [saving, setSaving] = useState(false);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (flashcards.length > prevCountRef.current) {
      const newCards = flashcards.slice(prevCountRef.current).map((fc) => ({
        ...fc,
        kept: true,
      }));
      setCardStates((prev) => [...prev, ...newCards]);
      prevCountRef.current = flashcards.length;
    }
  }, [flashcards]);

  useEffect(() => {
    if (status === 'complete' && suggestedDeckName) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDeckName(suggestedDeckName);
    }
  }, [status, suggestedDeckName]);

  useEffect(() => {
    if (status === 'error' && errorMessage) {
      toast.error(errorMessage);
    }
  }, [status, errorMessage]);

  const handleFileChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    if (f && !f.name.toLowerCase().endsWith('.pdf')) {
      toast.error(t('pdf_only'));
      e.target.value = '';
      return;
    }
    setFile(f);
  }, [t]);

  const handleGenerate = useCallback(async () => {
    if (!file) return;
    prevCountRef.current = 0;
    setCardStates([]);
    setDeckName('');
    await generate(file, language);
  }, [file, language, generate]);

  const handleCardChange = useCallback((index: number, field: keyof GeneratedFlashcard, value: string) => {
    setCardStates((prev) => prev.map((c, i) => (i === index ? { ...c, [field]: value } : c)));
  }, []);

  const toggleKeep = useCallback((index: number) => {
    setCardStates((prev) => prev.map((c, i) => (i === index ? { ...c, kept: !c.kept } : c)));
  }, []);

  const keptCount = cardStates.filter((c) => c.kept).length;

  const handleSave = useCallback(async () => {
    const kept = cardStates.filter((c) => c.kept);
    if (kept.length === 0) {
      toast.error(t('no_cards_kept'));
      return;
    }
    setSaving(true);
    try {
      const name = deckName.trim() || t('default_deck_name');
      const deckRes = await fetch('/api/v1/flashcards/decks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!deckRes.ok) throw new Error('Failed to create deck');
      const deckData = await deckRes.json();
      const deckId: string = deckData.data?.id;
      if (!deckId) throw new Error('No deck ID returned');

      for (const card of kept) {
        const cardRes = await fetch('/api/v1/flashcards', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            front: card.question,
            back: card.answer,
            deckId,
          }),
        });
        if (!cardRes.ok) throw new Error('Failed to create flashcard');
      }

      toast.success(t('deck_created', { count: kept.length }));
      router.push(`/app/flashcards/deck/${deckId}`);
    } catch {
      toast.error(t('save_failed'));
    } finally {
      setSaving(false);
    }
  }, [cardStates, deckName, router, t]);

  const handleReset = useCallback(() => {
    reset();
    prevCountRef.current = 0;
    setCardStates([]);
    setDeckName('');
    setFile(null);
  }, [reset]);

  const isGenerating = status === 'generating';
  const isComplete = status === 'complete';
  const isError = status === 'error';

  return (
    <div className="space-y-6">
      {status === 'idle' && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div>
              <Label htmlFor="pdf-file">{t('upload_label')}</Label>
              <Input
                id="pdf-file"
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="mt-1"
              />
              <p className="text-sm text-muted-foreground mt-1">{t('upload_hint')}</p>
            </div>

            <div>
              <Label htmlFor="language">{t('language_label')}</Label>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger id="language" className="w-40 mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="en">{t('lang_en')}</SelectItem>
                  <SelectItem value="pl">{t('lang_pl')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Button onClick={handleGenerate} disabled={!file}>
              <Sparkles className="mr-2 h-4 w-4" /> {t('generate_button')}
            </Button>
          </CardContent>
        </Card>
      )}

      {isGenerating && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6 flex items-center gap-4">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <div>
                <p className="font-medium">{t('generating')}</p>
                {progress.totalChunks > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t('chunk_progress', {
                      processed: progress.processedChunks,
                      total: progress.totalChunks,
                    })}
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {cardStates.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-lg font-semibold">
                {t('generated_so_far', { count: cardStates.length })}
              </h3>
              {renderCards()}
            </div>
          )}
        </div>
      )}

      {isComplete && (
        <div className="space-y-4">
          <Card>
            <CardContent className="p-6 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-green-600 flex items-center gap-2">
                    <Check className="h-5 w-5" /> {t('generation_complete')}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t('total_generated', { count: cardStates.length })}
                  </p>
                </div>
              </div>

              <div>
                <Label htmlFor="deck-name">{t('deck_name_label')}</Label>
                <Input
                  id="deck-name"
                  value={deckName}
                  onChange={(e) => setDeckName(e.target.value)}
                  className="mt-1"
                />
              </div>
            </CardContent>
          </Card>

          {cardStates.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">
                  {t('cards_title', { count: cardStates.length })}
                </h3>
                <p className="text-sm text-muted-foreground">
                  {t('kept_count', { count: keptCount })}
                </p>
              </div>
              {renderCards()}
            </div>
          )}

          <div className="flex gap-3">
            <Button onClick={handleSave} disabled={keptCount === 0 || saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Upload className="mr-2 h-4 w-4" />
              )}
              {t('save_deck', { count: keptCount })}
            </Button>
            <Button variant="outline" onClick={handleReset}>
              {t('start_over')}
            </Button>
          </div>
        </div>
      )}

      {isError && (
        <Card>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <div>
                <p className="font-medium">{t('error_title')}</p>
                <p className="text-sm">{errorMessage}</p>
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={handleGenerate}>
                {t('retry')}
              </Button>
              <Button variant="outline" onClick={handleReset}>
                {t('start_over')}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );

  function renderCards() {
    return (
      <div className="space-y-3">
        {cardStates.map((card, i) => (
          <Card key={i} className={card.kept ? '' : 'opacity-50'}>
            <CardContent className="p-4 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">{t('question_label')}</Label>
                  <Textarea
                    value={card.question}
                    onChange={(e) => handleCardChange(i, 'question', e.target.value)}
                    rows={2}
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{t('answer_label')}</Label>
                  <Textarea
                    value={card.answer}
                    onChange={(e) => handleCardChange(i, 'answer', e.target.value)}
                    rows={2}
                    className="mt-1"
                  />
                </div>
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{card.suggestedTopic || t('no_topic')}</Badge>
                  <Input
                    value={card.suggestedTopic}
                    onChange={(e) => handleCardChange(i, 'suggestedTopic', e.target.value)}
                    className="h-7 w-36 text-xs"
                    placeholder={t('topic_placeholder')}
                  />
                </div>
                <Button
                  variant={card.kept ? 'outline' : 'default'}
                  size="sm"
                  onClick={() => toggleKeep(i)}
                >
                  {card.kept ? (
                    <><Trash2 className="mr-1 h-3 w-3" /> {t('trash')}</>
                  ) : (
                    <><Check className="mr-1 h-3 w-3" /> {t('keep')}</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }
}
