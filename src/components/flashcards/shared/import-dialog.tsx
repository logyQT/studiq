'use client';

import { useState, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { Upload, FileText, AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { flashcardKeys } from '@/lib/query-keys';

type CsvPreviewRow = Record<string, string>;

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId?: string;
  t: ReturnType<typeof useTranslations>;
}

export function ImportDialog({ open, onOpenChange, deckId, t }: ImportDialogProps) {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [parsedRows, setParsedRows] = useState<CsvPreviewRow[]>([]);
  const [columnMap, setColumnMap] = useState<{
    front: string;
    back: string;
    topic: string | null;
    deck: string | null;
  }>({
    front: '',
    back: '',
    topic: null,
    deck: null,
  });
  const [columns, setColumns] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<{
    total: number;
    imported: number;
    errors: Array<{ row: number; error: string }>;
  } | null>(null);

  const reset = useCallback(() => {
    setStep('upload');
    setParsedRows([]);
    setColumnMap({ front: '', back: '', topic: null, deck: null });
    setColumns([]);
    setImportResult(null);
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const Papa = (await import('papaparse')).default;
      const result = Papa.parse<CsvPreviewRow>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });

      if (result.errors.length > 0 && result.data.length === 0) {
        toast.error(t('csv_parse_error'));
        return;
      }

      const cols = result.meta.fields ?? [];
      setColumns(cols);
      setParsedRows(result.data.slice(0, 50));

      const lower = cols.map((c) => c.toLowerCase());
      const autoMap = {
        front:
          cols[lower.findIndex((c) => c === 'front' || c === 'question' || c === 'q')] ??
          cols[0] ??
          '',
        back:
          cols[lower.findIndex((c) => c === 'back' || c === 'answer' || c === 'a')] ??
          cols[1] ??
          '',
        topic:
          cols[
            lower.findIndex((c) => c === 'topic' || c === 'topics' || c === 'tag' || c === 'tags')
          ] ?? null,
        deck:
          cols[lower.findIndex((c) => c === 'deck' || c === 'decks' || c === 'deck_name')] ?? null,
      };
      setColumnMap(autoMap);
      setStep('preview');
    },
    [t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files?.[0];
      if (file && (file.name.endsWith('.csv') || file.type === 'text/csv')) {
        handleFile(file);
      }
    },
    [handleFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleFile(file);
    },
    [handleFile],
  );

  const handleImport = useCallback(async () => {
    if (!columnMap.front || !columnMap.back) {
      toast.error(t('csv_map_required'));
      return;
    }

    setStep('importing');

    const cards = parsedRows.map((row) => ({
      front: row[columnMap.front] ?? '',
      back: row[columnMap.back] ?? '',
      topic: columnMap.topic ? row[columnMap.topic] || undefined : undefined,
      deck: columnMap.deck ? row[columnMap.deck] || undefined : undefined,
    }));

    try {
      const body: Record<string, unknown> = { cards };
      if (deckId) {
        body.deckId = deckId;
      } else {
        body.defaultDeckName = t('imported_deck_default_name');
      }
      const res = await fetch('/api/v1/flashcards/import/csv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const json = await res.json();

      if (!res.ok) {
        toast.error(json.error ?? t('import_failed'));
        setStep('preview');
        return;
      }

      setImportResult(json.data);
      setStep('done');

      if (deckId) {
        queryClient.removeQueries({ queryKey: flashcardKeys.list({ deckIds: [deckId] }) });
      }
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
    } catch {
      toast.error(t('import_failed'));
      setStep('preview');
    }
  }, [columnMap, parsedRows, deckId, t, queryClient]);

  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('import_title')}</DialogTitle>
          <DialogDescription>{t('import_desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {step === 'upload' && (
            <div
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
              className="flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 cursor-pointer hover:border-primary/50 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium">{t('drop_csv')}</p>
              <p className="text-sm text-muted-foreground mt-1">{t('csv_format_hint')}</p>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
            </div>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{t('n_rows_found', { count: parsedRows.length })}</span>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="font-medium">{t('csv_column_front')}</label>
                  <select
                    className="w-full mt-1 rounded-md border px-3 py-1.5 bg-background"
                    value={columnMap.front}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, front: e.target.value }))}
                  >
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-medium">{t('csv_column_back')}</label>
                  <select
                    className="w-full mt-1 rounded-md border px-3 py-1.5 bg-background"
                    value={columnMap.back}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, back: e.target.value }))}
                  >
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-medium">
                    {t('csv_column_topic')}{' '}
                    <span className="text-muted-foreground">({t('optional')})</span>
                  </label>
                  <select
                    className="w-full mt-1 rounded-md border px-3 py-1.5 bg-background"
                    value={columnMap.topic ?? ''}
                    onChange={(e) =>
                      setColumnMap((prev) => ({ ...prev, topic: e.target.value || null }))
                    }
                  >
                    <option value="">—</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="font-medium">
                    {t('csv_column_deck')}{' '}
                    <span className="text-muted-foreground">({t('optional')})</span>
                  </label>
                  <select
                    className="w-full mt-1 rounded-md border px-3 py-1.5 bg-background"
                    value={columnMap.deck ?? ''}
                    onChange={(e) =>
                      setColumnMap((prev) => ({ ...prev, deck: e.target.value || null }))
                    }
                  >
                    <option value="">—</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="border rounded-lg overflow-hidden max-h-60 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>{t('front_label')}</TableHead>
                      <TableHead>{t('back_label')}</TableHead>
                      {columnMap.topic && <TableHead>{t('topics_label')}</TableHead>}
                      {columnMap.deck && <TableHead>{t('deck_name_label')}</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {parsedRows.slice(0, 10).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                        <TableCell className="max-w-50 truncate">{row[columnMap.front]}</TableCell>
                        <TableCell className="max-w-50 truncate">{row[columnMap.back]}</TableCell>
                        {columnMap.topic && (
                          <TableCell className="max-w-37.5 truncate">
                            {row[columnMap.topic]}
                          </TableCell>
                        )}
                        {columnMap.deck && (
                          <TableCell className="max-w-37.5 truncate">
                            {row[columnMap.deck]}
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {parsedRows.length > 10 && (
                <p className="text-xs text-muted-foreground">
                  {t('showing_n_of', { n: 10, total: parsedRows.length })}
                </p>
              )}
            </div>
          )}

          {step === 'importing' && (
            <div className="flex flex-col items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
              <p>{t('importing')}</p>
            </div>
          )}

          {step === 'done' && importResult && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-lg bg-muted">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                <div>
                  <p className="font-medium">{t('import_complete')}</p>
                  <p className="text-sm text-muted-foreground">
                    {t('import_summary', {
                      imported: importResult.imported,
                      total: importResult.total,
                    })}
                  </p>
                </div>
              </div>
              {importResult.errors.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-medium flex items-center gap-1 text-destructive">
                    <AlertCircle className="h-4 w-4" />{' '}
                    {t('import_errors', { count: importResult.errors.length })}
                  </p>
                  <div className="max-h-40 overflow-y-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-12">{t('csv_row')}</TableHead>
                          <TableHead>{t('csv_error')}</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {importResult.errors.map((err, i) => (
                          <TableRow key={i}>
                            <TableCell>{err.row}</TableCell>
                            <TableCell className="text-destructive">{err.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          {step === 'upload' && (
            <Button variant="outline" onClick={handleClose}>
              {t('common_cancel')}
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  reset();
                  setStep('upload');
                }}
              >
                {t('back')}
              </Button>
              <Button onClick={handleImport}>
                {t('import_confirm', { count: parsedRows.length })}
              </Button>
            </>
          )}
          {step === 'done' && <Button onClick={handleClose}>{t('common_close')}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
