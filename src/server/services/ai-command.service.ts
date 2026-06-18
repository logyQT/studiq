import { callLLM } from '@/server/ai';
import { pdfService } from '@/server/services/pdf.service';
import { pdfCacheService } from '@/server/services/pdf-cache.service';
import { repairJson } from '@/server/providers/LLMProvider';
import type { ToolDefinition } from '@/server/ai/ai.types';
import type { RequestContext } from '@/lib/request-context';

const LOG_PREFIX = '[AiCommandService]';

const MAX_FILE_CHARS = parseInt(process.env.LLM_MAX_FILE_CHARS || '200000', 10);
const FLASHCARD_MAX_TOKENS = 4096;

const FLASHCARD_KEYWORDS = [
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
  'powtórka', 'powtórki', 'powtórkę', 'powtórc', 'powtórek',
  'powtórkom', 'powtórKami', 'powtorkach',
  // Polish — misc
  'zapamiętaj', 'zapamiętać', 'zapamiętywanie', 'zapamiętywać',
  'przypominajka',
];

const SYSTEM_PROMPT = `You are StudiQ AI, an expert educational assistant. You help users learn by creating flashcards, answering questions, and explaining concepts.

When the user asks you to create flashcards, use the generate_flashcards tool. Think about the content carefully:
- Make questions clear and specific
- Provide concise but complete answers
- Group related cards under meaningful topics
- Generate 5-12 cards unless the user specifies otherwise
- Suggest a descriptive deck name based on the topic
- If file content is provided in the message, base your flashcards on that content

Respond in the same language the user writes in. If they write in Polish, respond in Polish. If in English, respond in English.`;

const GENERATE_FLASHCARDS_TOOL: ToolDefinition = {
  type: 'function',
  function: {
    name: 'generate_flashcards',
    description: 'Generate educational flashcards from the user\'s request. Use when the user asks to create flashcards, study cards, review materials, or similar study aids.',
    parameters: {
      type: 'object',
      properties: {
        deck_name: {
          type: 'string',
          description: 'Suggested name for the flashcard deck based on the topic',
        },
        flashcards: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              front: { type: 'string', description: 'The question or term' },
              back: { type: 'string', description: 'The answer or definition' },
              topic: { type: 'string', description: 'Optional topic/category for grouping' },
            },
            required: ['front', 'back'],
          },
          description: 'Array of flashcards to generate',
        },
      },
      required: ['deck_name', 'flashcards'],
    },
  },
};

export interface FlashcardItem {
  front: string;
  back: string;
  topic?: string;
}

export interface FlashcardGenResult {
  type: 'flashcards';
  deckName: string;
  flashcards: FlashcardItem[];
}

export interface ChatResult {
  type: 'chat';
  content: string;
}

function hasFlashcardKeyword(text: string): boolean {
  const lower = text.toLowerCase();
  return FLASHCARD_KEYWORDS.some((kw) => lower.includes(kw));
}

function parseFlashcards(raw: unknown): FlashcardItem[] {
  const cards = typeof raw === 'string' ? JSON.parse(raw) : raw;
  return (Array.isArray(cards) ? cards : []).map((c: Record<string, unknown>) => ({
    front: String(c.front ?? ''),
    back: String(c.back ?? ''),
    topic: c.topic ? String(c.topic) : undefined,
  }));
}

async function extractFileContent(
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

export class AiCommandService {
  async generateFlashcards(text: string, file: { data: string; mimeType: string } | undefined, conversationId: string | undefined, ctx: RequestContext): Promise<FlashcardGenResult> {
    console.log(`${LOG_PREFIX} generateFlashcards called, text="${text.slice(0, 100)}", hasFile=${!!file}, conversationId=${conversationId ?? 'none'}`);

    let prompt = text;
    const extracted = await extractFileContent(file, conversationId);
    if (extracted) {
      prompt = `${text}\n\nFile content:\n${extracted}`;
      console.log(`${LOG_PREFIX} Prompt with file content: ${prompt.length} chars`);
    } else {
      console.log(`${LOG_PREFIX} No content available, using original text only`);
    }

    console.log(`${LOG_PREFIX} Calling LLM with tool_choice=generate_flashcards`);
    const response = await callLLM(
      {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        tools: [GENERATE_FLASHCARDS_TOOL],
        toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
        maxTokens: FLASHCARD_MAX_TOKENS,
      },
      ctx,
    );

    console.log(`${LOG_PREFIX} LLM response: content="${response.content.slice(0, 200)}", toolCalls=${response.toolCalls?.length ?? 0}`);

    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls.find((tc) => tc.function.name === 'generate_flashcards');
      if (toolCall) {
        console.log(`${LOG_PREFIX} Tool call arguments: ${toolCall.function.arguments.slice(0, 500)}`);
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          const repaired = repairJson(toolCall.function.arguments);
          console.log(`${LOG_PREFIX} JSON parse failed, repaired: ${repaired.slice(0, 200)}`);
          args = JSON.parse(repaired);
        }
        const flashcards = parseFlashcards(args.flashcards);
        console.log(`${LOG_PREFIX} Parsed ${flashcards.length} flashcards, deckName="${args.deck_name}"`);
        return {
          type: 'flashcards',
          deckName: String(args.deck_name || 'AI Generated Flashcards'),
          flashcards,
        };
      }
      console.log(`${LOG_PREFIX} No generate_flashcards tool call found in response`);
    } else {
      console.log(`${LOG_PREFIX} No tool calls in response, returning empty flashcards`);
    }

    return {
      type: 'flashcards',
      deckName: 'AI Generated Flashcards',
      flashcards: [],
    };
  }

  async chat(text: string, file: { data: string; mimeType: string } | undefined, conversationId: string | undefined, ctx: RequestContext): Promise<FlashcardGenResult | ChatResult> {
    const isFlashcard = hasFlashcardKeyword(text);
    console.log(`${LOG_PREFIX} chat called, text="${text.slice(0, 100)}", hasFile=${!!file}, flashcardKeyword=${isFlashcard}, conversationId=${conversationId ?? 'none'}`);

    if (isFlashcard) {
      return this.generateFlashcards(text, file, conversationId, ctx);
    }

    let prompt = text;
    const extracted = await extractFileContent(file, conversationId);
    if (extracted) {
      prompt = `${text}\n\nFile content:\n${extracted}`;
    }

    console.log(`${LOG_PREFIX} Calling LLM with tool_choice=auto`);
    const response = await callLLM(
      {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        tools: [GENERATE_FLASHCARDS_TOOL],
        toolChoice: 'auto',
        maxTokens: FLASHCARD_MAX_TOKENS,
      },
      ctx,
    );

    console.log(`${LOG_PREFIX} LLM response: content="${response.content.slice(0, 200)}", toolCalls=${response.toolCalls?.length ?? 0}`);

    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls.find((tc) => tc.function.name === 'generate_flashcards');
      if (toolCall) {
        console.log(`${LOG_PREFIX} Tool call arguments: ${toolCall.function.arguments.slice(0, 500)}`);
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          const repaired = repairJson(toolCall.function.arguments);
          console.log(`${LOG_PREFIX} JSON parse failed, repaired: ${repaired.slice(0, 200)}`);
          args = JSON.parse(repaired);
        }
        const flashcards = parseFlashcards(args.flashcards);
        console.log(`${LOG_PREFIX} Parsed ${flashcards.length} flashcards, deckName="${args.deck_name}"`);
        return {
          type: 'flashcards',
          deckName: String(args.deck_name || 'AI Generated Flashcards'),
          flashcards,
        };
      }
    }

    return {
      type: 'chat',
      content: response.content,
    };
  }
}

export const aiCommandService = new AiCommandService();
