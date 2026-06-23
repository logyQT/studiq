import { log } from '@/lib/logger';
import { pdfService } from '@/server/services/pdf.service';
import { pdfCacheService } from '@/server/services/pdf-cache.service';

export const MAX_FILE_CHARS = parseInt(process.env.LLM_MAX_FILE_CHARS || '200000', 10);
export const FLASHCARD_MAX_TOKENS = parseInt(process.env.LLM_FLASHCARD_MAX_TOKENS || '32768', 10);

export const FLASHCARD_KEYWORDS = [
  // English
  'flashcard', 'flash card', 'study card', 'index card', 'cue card',
  'flashcards', 'study cards', 'index cards',
  'study', 'review', 'learn', 'memorize', 'cheat sheet',
  // Polish — fiszka (all cases)
  'fiszka', 'fiszki', 'fiszkę', 'fiszce', 'fiszek',
  'fiszkom', 'fiszkami', 'fiszkach',
  // Polish — notatka
  'notatka', 'notatki', 'notatkę', 'notatce', 'notatek',
  'notatkom', 'notatkami', 'notatkach',
  // Polish — karta
  'karta', 'karty', 'kartę', 'karcie', 'kart',
  'kartom', 'kartami', 'kartach',
  // Polish — ściąga
  'ściąga', 'ściągę', 'ściągi', 'ściąg', 'ściągą',
  'ściągom', 'ściągami', 'ściągach',
  // Polish — powtórka
  'powtórka', 'powtórki', 'powtórkę', 'powtórce', 'powtórek',
  'powtórkom', 'powtórkami', 'powtorkach',
  // Polish — misc
  'zapamiętaj', 'zapamiętać', 'zapamiętywanie', 'zapamiętywać',
  'przypominajka',
];

export const SLOW_WARNING_MS = 30000;
export const VERY_SLOW_WARNING_MS = 60000;
export const MAX_STEP_RETRIES = 2;

export interface FlashcardItem {
  front: string;
  back: string;
  topic?: string;
}

export interface FlashcardGenResult {
  type: 'flashcards';
  deckName: string;
  flashcards: FlashcardItem[];
  content?: string;
}

export interface ChatResult {
  type: 'chat';
  content: string;
}

export interface ThinkingCallbacks {
  onThink: (trace: string) => void;
}

export interface ExtractedTerm {
  term: string;
  definition: string;
  context?: string;
  category?: string;
}

export interface GeneratedFlashcard {
  question: string;
  answer: string;
  suggestedTopic: string;
}

export function hasFlashcardKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FLASHCARD_KEYWORDS.some((kw) => lower.includes(kw));
}

export function parseFlashcards(raw: unknown): FlashcardItem[] {
  let cards: unknown;
  if (typeof raw === 'string') {
    try { cards = JSON.parse(raw); } catch { cards = []; }
  } else {
    cards = raw;
  }
  return (Array.isArray(cards) ? cards : []).map((c: Record<string, unknown>) => ({
    front: String(c.front ?? ''),
    back: String(c.back ?? ''),
    topic: c.topic ? String(c.topic) : undefined,
  }));
}

export function parseExtractedTerms(raw: unknown): ExtractedTerm[] {
  let data: unknown;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { data = []; }
  } else {
    data = raw;
  }
  const terms = (data as Record<string, unknown>)?.terms ?? (Array.isArray(data) ? data : []);
  return (Array.isArray(terms) ? terms : []).map((t: Record<string, unknown>) => ({
    term: String(t.term ?? ''),
    definition: String(t.definition ?? ''),
    context: t.context ? String(t.context) : undefined,
    category: t.category ? String(t.category) : undefined,
  }));
}

export function repairJson(raw: string): string {
  let s = raw.trim();
  if (!s.startsWith('[') || !s.endsWith(']')) {
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start !== -1 && end > start) s = s.slice(start, end + 1);
  }
  s = s.replace(/,(\s*[}\]])/g, '$1');
  const openBrackets = (s.match(/\{/g) || []).length;
  const closeBrackets = (s.match(/\}/g) || []).length;
  const openSquares = (s.match(/\[/g) || []).length;
  const closeSquares = (s.match(/\]/g) || []).length;
  for (let i = 0; i < openBrackets - closeBrackets; i++) s += '}';
  for (let i = 0; i < openSquares - closeSquares; i++) s += ']';
  const lastClose = s.lastIndexOf('}');
  if (lastClose !== -1 && lastClose < s.length - 1) s = s.slice(0, lastClose + 1);
  const finalBracket = s.lastIndexOf(']');
  if (finalBracket !== -1 && finalBracket < s.length - 1) s = s.slice(0, finalBracket + 1);
  return s;
}

export function parseReviewResult(raw: unknown): { kept: number[]; reasons: Record<string, string> } {
  let data: unknown;
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw); } catch { data = {}; }
  } else {
    data = raw;
  }
  const d = data as Record<string, unknown> | undefined;
  return {
    kept: Array.isArray(d?.kept) ? d.kept.map(Number) : [],
    reasons: d?.reasons && typeof d.reasons === 'object' ? (d.reasons as Record<string, string>) : {},
  };
}

export function parseToolCallArgs<T = Record<string, unknown>>(toolCalls: Array<{ function: { name: string; arguments: string } }> | undefined, toolName: string): T | null {
  if (!toolCalls || toolCalls.length === 0) {
    log.ai.debug('parseToolCallArgs: no tool calls provided');
    return null;
  }
  const toolCall = toolCalls.find((tc) => tc.function.name === toolName);
  if (!toolCall) {
    log.ai.debug(`parseToolCallArgs: tool "${toolName}" not found`, { metadata: { available: toolCalls.map((tc) => tc.function.name).join(', ') } });
    return null;
  }
  log.ai.debug(`parseToolCallArgs: parsing "${toolName}"`, { metadata: { argsLength: toolCall.function.arguments.length } });
  try {
    return JSON.parse(toolCall.function.arguments) as T;
  } catch (_parseError) {
    log.ai.debug(`parseToolCallArgs: JSON.parse failed for "${toolName}", attempting repair`);
    try {
      const repaired = repairJson(toolCall.function.arguments);
      log.ai.debug(`parseToolCallArgs: repaired args (first 200): ${repaired.slice(0, 200)}`);
      return JSON.parse(repaired) as T;
    } catch (_repairError) {
      log.ai.error(`parseToolCallArgs: repair also failed for "${toolName}"`);
      return null;
    }
  }
}

export function startSlowTimers(callbacks?: ThinkingCallbacks): NodeJS.Timeout[] {
  const slowTimer = setTimeout(() => {
    callbacks?.onThink('This step is taking longer than usual...');
  }, SLOW_WARNING_MS);
  const verySlowTimer = setTimeout(() => {
    callbacks?.onThink('Still working, almost there...');
  }, VERY_SLOW_WARNING_MS);
  return [slowTimer, verySlowTimer];
}

export function clearSlowTimers(timers: NodeJS.Timeout[]): void {
  for (const t of timers) clearTimeout(t);
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  isRetryable: (result: T) => boolean,
  maxRetries: number,
  stepLabel: string,
  callbacks?: ThinkingCallbacks,
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const result = await fn();
    if (!isRetryable(result) || attempt === maxRetries) return result;
    callbacks?.onThink(`${stepLabel} — retrying (${attempt + 2}/${maxRetries + 1})...`);
    await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
  }
  throw new Error('unreachable');
}

export async function extractFileContent(
  file: { data: string; mimeType: string } | undefined,
  conversationId: string | undefined,
): Promise<string> {
  // If no file uploaded, try cache
  if (!file) {
    if (conversationId) {
      const cached = pdfCacheService.get(conversationId);
      if (cached) {
        log.ai.info(`Retrieved ${cached.text.length} chars from cache for conversation ${conversationId}`);
        return cached.text;
      }
    }
    return '';
  }

  try {
    let extracted = '';
    if (file.mimeType === 'application/pdf') {
      log.pdf.info('Extracting text from PDF attachment');
      const buffer = Buffer.from(file.data, 'base64');
      extracted = await pdfService.extractText(buffer);
      log.pdf.info(`PDF extracted ${extracted.length} chars`);
    } else if (file.mimeType === 'text/plain') {
      extracted = Buffer.from(file.data, 'base64').toString('utf-8');
      log.pdf.info(`Text file extracted ${extracted.length} chars`);
    } else {
      log.pdf.warn(`Unsupported file type: ${file.mimeType}`);
      return '';
    }

    // Truncate to configurable limit
    if (extracted.length > MAX_FILE_CHARS) {
      log.pdf.warn(`Truncating file content from ${extracted.length} to ${MAX_FILE_CHARS} chars`);
      extracted = extracted.slice(0, MAX_FILE_CHARS);
    }

    // Cache for conversation persistence
    if (conversationId && extracted) {
      pdfCacheService.set(conversationId, extracted, file.mimeType);
    }

    return extracted;
  } catch (error) {
    log.pdf.error('File extraction failed', { metadata: { error } });
    return '';
  }
}
