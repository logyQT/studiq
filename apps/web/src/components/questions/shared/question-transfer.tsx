'use client';

import { csvRecordsToQuestions, questionsToCsv } from '@studiq/server/lib/question-transfer';
import {
  IMPORT_MAX_QUESTIONS,
  TransferQuestionSchema,
  type TransferQuestion,
} from '@studiq/server/models/question-transfer.model';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { AlertCircle, ArrowDownToLine, ArrowUpFromLine, FileUp, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';
import { questionKeys } from '@/lib/query-keys';

const MAX_FILE_BYTES = 1_000_000;
const PREVIEW_ROWS = 5;
const SHOWN_PROBLEMS = 8;

/** Sample rows of the downloadable CSV template: one of every question type. */
const TEMPLATE: TransferQuestion[] = [
  {
    type: 'mcq',
    content: 'Stolica Polski to…',
    explanation: 'Warszawa jest stolicą od 1596 roku.',
    topics: ['Geografia'],
    answers: [
      { content: 'Kraków', isCorrect: false },
      { content: 'Warszawa', isCorrect: true },
      { content: 'Gdańsk', isCorrect: false },
    ],
  },
  {
    type: 'true_false',
    content: 'Wisła wpada do Morza Bałtyckiego.',
    topics: ['Geografia'],
    answers: [
      { content: 'Prawda', isCorrect: true },
      { content: 'Fałsz', isCorrect: false },
    ],
  },
  { type: 'open', content: 'Opisz, czym jest fotosynteza.', topics: [], answers: [] },
];

type Problem = { row: number; kind: 'type' | 'content' | 'answers' | 'correct' | 'other' };

/**
 * Saves a body as a file. The anchor is attached while it is clicked and the object URL is
 * revoked on a later task, because Firefox and Safari cancel a download whose URL disappears
 * (or whose anchor was never in the document) before the browser has started it.
 */
function download(filename: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  // Both the anchor and its URL outlive the click: a download that has not started yet is
  // cancelled when either disappears.
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 0);
}

/** Reads a CSV or JSON file into questions, with every row problem found on the way. */
async function readFile(
  file: File,
): Promise<{ questions: TransferQuestion[]; problems: Problem[] } | { error: 'unreadable' }> {
  const text = await file.text();
  let raw: unknown[];
  const problems: Problem[] = [];

  try {
    if (file.name.toLowerCase().endsWith('.json')) {
      const json = JSON.parse(text);
      raw = Array.isArray(json) ? json : json.questions;
      if (!Array.isArray(raw)) return { error: 'unreadable' };
    } else {
      const Papa = (await import('papaparse')).default;
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        // The BOM an export starts with stays on the first header when a file is read as bytes.
        transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase(),
      });
      if (parsed.data.length === 0 && parsed.errors.length > 0) return { error: 'unreadable' };
      const read = csvRecordsToQuestions(parsed.data);
      raw = read.questions;
      for (const issue of read.issues) problems.push({ row: issue.row, kind: 'correct' });
    }
  } catch {
    return { error: 'unreadable' };
  }

  const questions: TransferQuestion[] = [];
  raw.forEach((item, index) => {
    const parsed = TransferQuestionSchema.safeParse(item);
    if (parsed.success) {
      questions.push(parsed.data);
      return;
    }
    const kinds = new Set<Problem['kind']>();
    for (const issue of parsed.error.issues) {
      const field = issue.path[0];
      kinds.add(field === 'type' || field === 'content' || field === 'answers' ? field : 'other');
    }
    for (const kind of kinds) problems.push({ row: index + 1, kind });
  });

  // CSV mapping problems and schema problems are found in separate passes; show them by row.
  problems.sort((a, b) => a.row - b.row);
  return { questions, problems };
}

interface ImportDialogProps {
  bankId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Reads a file, shows every row problem it found and sends nothing until the whole file is
 * clean: a partial import would leave the user guessing which rows made it. The dialog stays
 * open on failure so the same file can be fixed and loaded again.
 */
function ImportDialog({ bankId, open, onOpenChange }: ImportDialogProps) {
  const t = useTranslations('QuestionTransfer');
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [questions, setQuestions] = useState<TransferQuestion[]>([]);
  const [problems, setProblems] = useState<Problem[]>([]);
  const [sending, setSending] = useState(false);

  function reset() {
    setFileName(null);
    setQuestions([]);
    setProblems([]);
    if (fileInput.current) fileInput.current.value = '';
  }

  function close(next: boolean) {
    if (sending) return;
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleFile(file: File) {
    reset();
    if (file.size > MAX_FILE_BYTES) {
      toast.error(t('file_too_large'));
      return;
    }
    const result = await readFile(file);
    if ('error' in result) {
      toast.error(t('unreadable'));
      return;
    }
    if (result.questions.length + new Set(result.problems.map((p) => p.row)).size === 0) {
      toast.error(t('no_questions'));
      return;
    }
    if (result.questions.length > IMPORT_MAX_QUESTIONS) {
      toast.error(t('too_many', { count: result.questions.length, max: IMPORT_MAX_QUESTIONS }));
      return;
    }
    setFileName(file.name);
    setQuestions(result.questions);
    setProblems(result.problems);
  }

  async function handleImport() {
    setSending(true);
    try {
      const res = await fetch(`/api/v1/questions/banks/${bankId}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questions }),
      });
      const json = await res.json().catch(() => null);

      if (!res.ok) {
        const message =
          json?.error === 'USAGE_LIMIT_EXCEEDED'
            ? t('limit_exceeded')
            : res.status === 403
              ? t('forbidden')
              : t('import_failed');
        toast.error(message);
        return;
      }

      toast.success(t('imported', { count: json?.data?.imported ?? questions.length }));
      queryClient.invalidateQueries({ queryKey: questionKeys.all });
      reset();
      onOpenChange(false);
    } catch {
      toast.error(t('import_failed'));
    } finally {
      setSending(false);
    }
  }

  const hasProblems = problems.length > 0;
  const ready = fileName !== null && !hasProblems && questions.length > 0;
  const typeLabel: Record<TransferQuestion['type'], string> = {
    mcq: t('type_mcq'),
    true_false: t('type_true_false'),
    open: t('type_open'),
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t('import_title')}</DialogTitle>
          <DialogDescription>{t('import_desc')}</DialogDescription>
        </DialogHeader>

        <div className="flex-1 min-h-0 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInput}
              type="file"
              accept=".csv,.json,text/csv,application/json"
              className="sr-only"
              aria-label={t('choose_file')}
              data-testid="question-import-file"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
              }}
            />
            <Button variant="outline" onClick={() => fileInput.current?.click()}>
              <FileUp className="mr-2 h-4 w-4" />
              {fileName ?? t('choose_file')}
            </Button>
            <Button
              variant="link"
              className="px-0"
              onClick={() =>
                download(
                  'questions-template.csv',
                  questionsToCsv(TEMPLATE),
                  'text/csv;charset=utf-8',
                )
              }
            >
              {t('download_template')}
            </Button>
          </div>

          {fileName && ready && (
            <p className="text-sm text-muted-foreground">
              {t('ready', { count: questions.length })}
            </p>
          )}

          {hasProblems && (
            <div role="alert" className="rounded-md border border-destructive/40 p-3 text-sm">
              <p className="flex items-center gap-2 font-medium text-destructive">
                <AlertCircle className="h-4 w-4" aria-hidden="true" />
                {t('problems_title')}
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-6">
                {problems.slice(0, SHOWN_PROBLEMS).map((problem) => (
                  <li key={`${problem.row}-${problem.kind}`}>
                    {t('problem_row', { row: problem.row, problem: t(`problem_${problem.kind}`) })}
                  </li>
                ))}
              </ul>
              {problems.length > SHOWN_PROBLEMS && (
                <p className="mt-2 text-muted-foreground">
                  {t('problems_more', { count: problems.length - SHOWN_PROBLEMS })}
                </p>
              )}
            </div>
          )}

          {ready && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_question')}</TableHead>
                  <TableHead>{t('col_type')}</TableHead>
                  <TableHead>{t('col_answers')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {questions.slice(0, PREVIEW_ROWS).map((question, i) => (
                  <TableRow key={`${i}-${question.content}`}>
                    <TableCell className="max-w-xs truncate">{question.content}</TableCell>
                    <TableCell>{typeLabel[question.type]}</TableCell>
                    <TableCell>{question.answers.length}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={sending}>
            {t('cancel')}
          </Button>
          <Button onClick={handleImport} disabled={!ready || sending}>
            {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
            {sending ? t('importing') : t('import_button')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Export (CSV / JSON) and import actions of a question bank (#652). Rules, as the API applies
 * them: reading a bank means having all of it, so anyone who can read it may export it (the
 * file contains the answer key and explanations); importing adds to the bank, so it needs the
 * right to update it.
 */
export function QuestionBankTransfer({
  bankId,
  canImport,
}: {
  bankId: string;
  canImport: boolean;
}) {
  const t = useTranslations('QuestionTransfer');
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  // A fetch instead of a plain link: a refusal (bank too large, no access) has to be a message,
  // not a JSON document in a new tab, and the not-re-importable warning arrives in a header.
  async function handleExport(format: 'csv' | 'json') {
    setExporting(true);
    try {
      const res = await fetch(`/api/v1/questions/banks/${bankId}/export?format=${format}`);
      if (!res.ok) {
        toast.error(res.status === 422 ? t('export_too_large') : t('export_failed'));
        return;
      }
      const filename =
        /filename="([^"]+)"/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ??
        `questions.${format}`;
      // The body is read as a blob, not text: `res.text()` decodes UTF-8 and drops the leading
      // BOM, and Excel then renders Polish characters as mojibake.
      download(filename, await res.blob(), res.headers.get('Content-Type') ?? 'text/plain');
      const skipped = Number(res.headers.get('X-Studiq-Not-Reimportable') ?? 0);
      if (skipped > 0) toast.warning(t('export_not_reimportable', { count: skipped }));
    } catch {
      toast.error(t('export_failed'));
    } finally {
      setExporting(false);
    }
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('menu_label')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-w-72">
          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
            {t('export_note')}
          </DropdownMenuLabel>
          <DropdownMenuItem disabled={exporting} onSelect={() => void handleExport('csv')}>
            <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('export_csv')}
          </DropdownMenuItem>
          <DropdownMenuItem disabled={exporting} onSelect={() => void handleExport('json')}>
            <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('export_json')}
          </DropdownMenuItem>
          {canImport && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setImportOpen(true)}>
                <ArrowUpFromLine className="mr-2 h-4 w-4" aria-hidden="true" />
                {t('import_action')}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {canImport && <ImportDialog bankId={bankId} open={importOpen} onOpenChange={setImportOpen} />}
    </>
  );
}
