'use client';

import {
  CSV_IMPORT_MAX_ROWS,
  type CsvImportResult,
  type CsvImportRowError,
} from '@studiq/server/models/flashcard-import.model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, FileText, Loader2, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ApiError, apiPost, isNetworkError } from '@/lib/api';
import {
  autoMapColumns,
  type CsvColumnMap,
  type CsvRecord,
  isCsvFile,
  parseCsv,
  toImportCards,
} from '@/lib/csv-import';
import { translateErrorCode } from '@/lib/error-messages';
import { flashcardKeys } from '@/lib/query-keys';

/** The dialog's own name for the column a row error is about. */
const FIELD_LABELS: Record<CsvImportRowError['field'], string> = {
  front: 'front_label',
  back: 'back_label',
  topic: 'topics_label',
  deck: 'deck_name_label',
};

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  deckId?: string;
  t: ReturnType<typeof useTranslations>;
}

export function ImportDialog({ open, onOpenChange, deckId, t }: ImportDialogProps) {
  const queryClient = useQueryClient();
  const tError = useTranslations('Errors');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<'upload' | 'preview' | 'importing' | 'done'>('upload');
  const [parsedRows, setParsedRows] = useState<CsvRecord[]>([]);
  const [columnMap, setColumnMap] = useState<CsvColumnMap>({
    front: '',
    back: '',
    topic: null,
    deck: null,
  });
  const [columns, setColumns] = useState<string[]>([]);
  const [importResult, setImportResult] = useState<CsvImportResult | null>(null);
  const tooManyRows = parsedRows.length > CSV_IMPORT_MAX_ROWS;
  /** Every picker offers the same columns, and „—” to leave its field unmapped. */
  const columnOptions = [
    <option key="" value="">
      —
    </option>,
    ...columns.map((c) => (
      <option key={c} value={c}>
        {c}
      </option>
    )),
  ];

  const reset = useCallback(() => {
    setStep('upload');
    setParsedRows([]);
    setColumnMap({ front: '', back: '', topic: null, deck: null });
    setColumns([]);
    setImportResult(null);
  }, []);

  /** The one way a file gets in, whether it was picked or dropped. */
  const openFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      const parsed = isCsvFile(file) ? await parseCsv(await file.text()) : null;
      if (!parsed) {
        toast.error(t('csv_parse_error'));
        return;
      }

      setColumns(parsed.columns);
      setParsedRows(parsed.rows);
      setColumnMap(autoMapColumns(parsed.columns));
      setStep('preview');
    },
    [t],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      void openFile(e.dataTransfer.files[0]);
    },
    [openFile],
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      void openFile(e.target.files?.[0]);
      // Picking the same file again after a refusal must fire another change.
      e.target.value = '';
    },
    [openFile],
  );

  const handleImport = useCallback(async () => {
    if (!columnMap.front || !columnMap.back) {
      toast.error(t('csv_map_required'));
      return;
    }

    setStep('importing');

    const cards = toImportCards(parsedRows, columnMap);

    try {
      const body: Record<string, unknown> = { cards };
      if (deckId) {
        body.deckId = deckId;
      } else {
        body.defaultDeckName = t('imported_deck_default_name');
      }
      const result = await apiPost<CsvImportResult>('/api/v1/flashcards/import/csv', body);

      setImportResult(result);
      setStep('done');

      if (deckId) {
        void queryClient.invalidateQueries({ queryKey: ['flashcards', deckId] });
      }
      void queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
    } catch (error) {
      toast.error(
        error instanceof ApiError && !isNetworkError(error)
          ? translateErrorCode(tError, error.code)
          : t('import_failed'),
      );
      setStep('preview');
    }
  }, [columnMap, parsedRows, deckId, t, tError, queryClient]);

  const handleClose = useCallback(() => {
    reset();
    onOpenChange(false);
  }, [reset, onOpenChange]);

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DialogContent className="sm:max-w-3xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('import_title')}</DialogTitle>
          <DialogDescription>{t('import_desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto min-h-0">
          {step === 'upload' && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                className="hidden"
                onChange={handleFileSelect}
              />
              <button
                type="button"
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                className="flex w-full flex-col items-center justify-center border-2 border-dashed rounded-lg p-12 cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-12 w-12 text-muted-foreground mb-4" />
                <span className="text-lg font-medium">{t('drop_csv')}</span>
                <span className="text-sm text-muted-foreground mt-1">{t('csv_format_hint')}</span>
              </button>
            </>
          )}

          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <FileText className="h-4 w-4" />
                <span>{t('n_rows_found', { count: parsedRows.length })}</span>
              </div>
              {tooManyRows && (
                <p role="alert" className="flex items-center gap-1 text-sm text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0" /> {tError('ERROR_VALIDATION_FAILED')}
                </p>
              )}

              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <label className="font-medium">{t('csv_column_front')}</label>
                  <select
                    className="w-full mt-1 rounded-md border px-3 py-1.5 bg-background"
                    value={columnMap.front}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, front: e.target.value }))}
                  >
                    {columnOptions}
                  </select>
                </div>
                <div>
                  <label className="font-medium">{t('csv_column_back')}</label>
                  <select
                    className="w-full mt-1 rounded-md border px-3 py-1.5 bg-background"
                    value={columnMap.back}
                    onChange={(e) => setColumnMap((prev) => ({ ...prev, back: e.target.value }))}
                  >
                    {columnOptions}
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
                    {columnOptions}
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
                    {columnOptions}
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
                            <TableCell className="text-destructive">
                              {t(FIELD_LABELS[err.field])}: {translateErrorCode(tError, err.error)}
                            </TableCell>
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
              <Button onClick={handleImport} disabled={tooManyRows}>
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
