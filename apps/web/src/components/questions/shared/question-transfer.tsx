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

function download(filename: string, body: string, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
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
 * Export (CSV / JSON) and import actions of a question bank (#652). Only offered to people
 * who may change the bank; the API enforces the same rules.
 */
export function QuestionBankTransfer({ bankId }: { bankId: string }) {
  const t = useTranslations('QuestionTransfer');
  const [importOpen, setImportOpen] = useState(false);

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline">
            <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('menu_label')}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem asChild>
            <a href={`/api/v1/questions/banks/${bankId}/export?format=csv`} download>
              <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('export_csv')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={`/api/v1/questions/banks/${bankId}/export?format=json`} download>
              <ArrowDownToLine className="mr-2 h-4 w-4" aria-hidden="true" />
              {t('export_json')}
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setImportOpen(true)}>
            <ArrowUpFromLine className="mr-2 h-4 w-4" aria-hidden="true" />
            {t('import_action')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ImportDialog bankId={bankId} open={importOpen} onOpenChange={setImportOpen} />
    </>
  );
}
