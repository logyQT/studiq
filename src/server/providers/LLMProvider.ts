import type { ToolDefinition, ToolCall } from '@/server/ai/ai.types';

export interface GeneratedFlashcard {
  question: string;
  answer: string;
  suggestedTopic: string;
}

export interface StreamCallbacks {
  onToken: (token: string) => void;
}

export type GenerateChatResult = {
  content: string;
  toolCalls?: ToolCall[];
};

export interface LLMProvider {
  generateFlashcardsFromChunk(chunk: string, language: string): Promise<GeneratedFlashcard[]>;
  generateChat(prompt: string, systemPrompt?: string, tools?: ToolDefinition[], toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } }, maxTokens?: number): Promise<GenerateChatResult | string>;
  generateChatStreaming(prompt: string, systemPrompt: string | undefined, callbacks: StreamCallbacks): Promise<string>;
}

function tryParse(raw: string): unknown {
  return JSON.parse(raw);
}

export function repairJson(raw: string): string {
  let s = raw.trim();

  if (!s.startsWith('[') || !s.endsWith(']')) {
    const start = s.indexOf('[');
    const end = s.lastIndexOf(']');
    if (start !== -1 && end > start) {
      s = s.slice(start, end + 1);
    }
  }

  s = s.replace(/,(\s*[}\]])/g, '$1');

  const openBrackets = (s.match(/\{/g) || []).length;
  const closeBrackets = (s.match(/\}/g) || []).length;
  const openSquares = (s.match(/\[/g) || []).length;
  const closeSquares = (s.match(/\]/g) || []).length;

  for (let i = 0; i < openBrackets - closeBrackets; i++) s += '}';
  for (let i = 0; i < openSquares - closeSquares; i++) s += ']';

  const lastClose = s.lastIndexOf('}');
  if (lastClose !== -1 && lastClose < s.length - 1) {
    s = s.slice(0, lastClose + 1);
  }
  const finalBracket = s.lastIndexOf(']');
  if (finalBracket !== -1 && finalBracket < s.length - 1) {
    s = s.slice(0, finalBracket + 1);
  }

  return s;
}

function extractArray(raw: string): string {
  const trimmed = raw.trim();

  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  const extracted = codeBlock ? codeBlock[1].trim() : trimmed;

  const start = extracted.indexOf('[');
  const end = extracted.lastIndexOf(']');
  if (start !== -1 && end > start) {
    return extracted.slice(start, end + 1);
  }

  return extracted;
}

function extractFlashcardsByPattern(text: string): GeneratedFlashcard[] {
  const results: GeneratedFlashcard[] = [];
  const objPattern = /\{"question"\s*:\s*"(.*?)"\s*,\s*"answer"\s*:\s*"(.*?)"\s*(?:,\s*"suggestedTopic"\s*:\s*"(.*?)")?\s*\}/g;
  let match: RegExpExecArray | null;

  while ((match = objPattern.exec(text)) !== null) {
    results.push({
      question: match[1].replace(/\\"/g, '"'),
      answer: match[2].replace(/\\"/g, '"'),
      suggestedTopic: match[3] ? match[3].replace(/\\"/g, '"') : '',
    });
  }

  return results;
}

function unescapeJson(raw: string): string {
  return raw
    .replace(/\\(?!["\\/bfnrtu])/g, '\\\\')
    .replace(/\r\n?/g, '\\n')
    .replace(/\t/g, '\\t');
}

export function parseJsonResponse(text: string): GeneratedFlashcard[] {
  let raw = extractArray(text);

  let parsed: unknown;
  try {
    parsed = tryParse(raw);
  } catch {
    raw = repairJson(raw);
    try {
      parsed = tryParse(raw);
    } catch {
      try {
        parsed = tryParse(unescapeJson(raw));
      } catch {
        const extracted = extractFlashcardsByPattern(text);
        if (extracted.length > 0) {
          return extracted;
        }
        throw new Error(
          `Failed to parse LLM response as JSON. Length=${text.length}, snippet="${text.slice(0, 300)}...", tail="...${text.slice(-200)}"`,
        );
      }
    }
  }

  const array = Array.isArray(parsed) ? parsed : (parsed as Record<string, unknown>).flashcards;
  if (!Array.isArray(array)) {
    const extracted = extractFlashcardsByPattern(text);
    if (extracted.length > 0) {
      return extracted;
    }
    throw new Error('Response does not contain a flashcard array');
  }

  return array.map((item: Record<string, unknown>) => ({
    question: String(item.question ?? ''),
    answer: String(item.answer ?? ''),
    suggestedTopic: String(item.suggestedTopic ?? ''),
  }));
}

export const FLASHCARD_PROMPT = `You are a bilingual flashcard generator (English + Polish).
Given the following text, produce JSON flashcards in the following format:

[
  {
    "question": "...",
    "answer": "...",
    "suggestedTopic": "..."
  }
]

Language: {language}
Text: {chunk}

Rules:
- Respond ONLY with valid JSON array.
- Do NOT include explanations or markdown formatting.
- If the text is Polish, generate Polish flashcards.
- If the text is English, generate English flashcards.
- If the text is mixed, detect language per chunk.`;
