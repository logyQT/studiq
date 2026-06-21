import { repairJson } from '@/server/providers/LLMProvider';
import { pdfService } from '@/server/services/pdf.service';
import { pdfCacheService } from '@/server/services/pdf-cache.service';

export const LOG_PREFIX = '[AiCommandService]';

export const MAX_FILE_CHARS = parseInt(process.env.LLM_MAX_FILE_CHARS || '200000', 10);
export const FLASHCARD_MAX_TOKENS = parseInt(process.env.LLM_FLASHCARD_MAX_TOKENS || '16384', 10);

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

export function hasFlashcardKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FLASHCARD_KEYWORDS.some((kw) => lower.includes(kw));
}

export function parseFlashcards(raw: unknown): FlashcardItem[] {
  const cards = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return (Array.isArray(cards) ? cards : []).map((c: Record<string, unknown>) => ({
    front: String(c.front ?? ''),
    back: String(c.back ?? ''),
    topic: c.topic ? String(c.topic) : undefined,
  }));
}

export function parseExtractedTerms(raw: unknown): ExtractedTerm[] {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const terms = data?.terms ?? (Array.isArray(data) ? data : []);
  return (Array.isArray(terms) ? terms : []).map((t: Record<string, unknown>) => ({
    term: String(t.term ?? ''),
    definition: String(t.definition ?? ''),
    context: t.context ? String(t.context) : undefined,
    category: t.category ? String(t.category) : undefined,
  }));
}

export function parseReviewResult(raw: unknown): { kept: number[]; reasons: Record<string, string> } {
  const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return {
    kept: Array.isArray(data?.kept) ? data.kept.map(Number) : [],
    reasons: data?.reasons && typeof data.reasons === 'object' ? data.reasons : {},
  };
}

export function parseToolCallArgs<T = Record<string, unknown>>(toolCalls: Array<{ function: { name: string; arguments: string } }> | undefined, toolName: string): T | null {
  if (!toolCalls || toolCalls.length === 0) {
    console.log(`${LOG_PREFIX} parseToolCallArgs: no tool calls provided`);
    return null;
  }
  const toolCall = toolCalls.find((tc) => tc.function.name === toolName);
  if (!toolCall) {
    console.log(`${LOG_PREFIX} parseToolCallArgs: tool "${toolName}" not found in [${toolCalls.map((tc) => tc.function.name).join(', ')}]`);
    return null;
  }
  console.log(`${LOG_PREFIX} parseToolCallArgs: parsing "${toolName}", args length=${toolCall.function.arguments.length}`);
  try {
    return JSON.parse(toolCall.function.arguments) as T;
  } catch (_parseError) {
    console.log(`${LOG_PREFIX} parseToolCallArgs: JSON.parse failed for "${toolName}", attempting repair`);
    try {
      const repaired = repairJson(toolCall.function.arguments);
      console.log(`${LOG_PREFIX} parseToolCallArgs: repaired args (first 200): ${repaired.slice(0, 200)}`);
      return JSON.parse(repaired) as T;
    } catch (_repairError) {
      console.error(`${LOG_PREFIX} parseToolCallArgs: repair also failed for "${toolName}"`);
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
        console.log(`${LOG_PREFIX} Retrieved ${cached.text.length} chars from cache for conversation ${conversationId}`);
        return cached.text;
      }
    }
    return '';
  }

  try {
    let extracted = '';
    if (file.mimeType === 'application/pdf') {
      console.log(`${LOG_PREFIX} Extracting text from PDF attachment`);
      const buffer = Buffer.from(file.data, 'base64');
      extracted = await pdfService.extractText(buffer);
      console.log(`${LOG_PREFIX} PDF extracted ${extracted.length} chars`);
    } else if (file.mimeType === 'text/plain') {
      extracted = Buffer.from(file.data, 'base64').toString('utf-8');
      console.log(`${LOG_PREFIX} Text file extracted ${extracted.length} chars`);
    } else {
      console.log(`${LOG_PREFIX} Unsupported file type: ${file.mimeType}`);
      return '';
    }

    // Truncate to configurable limit
    if (extracted.length > MAX_FILE_CHARS) {
      console.log(`${LOG_PREFIX} Truncating file content from ${extracted.length} to ${MAX_FILE_CHARS} chars`);
      extracted = extracted.slice(0, MAX_FILE_CHARS);
    }

    // Cache for conversation persistence
    if (conversationId && extracted) {
      pdfCacheService.set(conversationId, extracted, file.mimeType);
    }

    return extracted;
  } catch (error) {
    console.error(`${LOG_PREFIX} File extraction failed:`, error);
    return '';
  }
}
