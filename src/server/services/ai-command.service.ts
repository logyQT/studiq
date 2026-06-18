import { callLLM } from '@/server/ai';
import { pdfService } from '@/server/services/pdf.service';
import type { ToolDefinition } from '@/server/ai/ai.types';
import type { RequestContext } from '@/lib/request-context';

const LOG_PREFIX = '[AiCommandService]';

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
  'powtórka', 'powtórki', 'powtórkę', 'powtórce', 'powtórek',
  'powtórkom', 'powtórkami', 'powtorkach',
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

async function extractFileContent(file: { data: string; mimeType: string }): Promise<string> {
  try {
    if (file.mimeType === 'application/pdf') {
      console.log(`${LOG_PREFIX} Extracting text from PDF attachment`);
      const buffer = Buffer.from(file.data, 'base64');
      const text = await pdfService.extractText(buffer);
      console.log(`${LOG_PREFIX} PDF extracted ${text.length} chars`);
      return text.slice(0, 15000);
    }
    if (file.mimeType === 'text/plain') {
      const text = Buffer.from(file.data, 'base64').toString('utf-8').slice(0, 15000);
      console.log(`${LOG_PREFIX} Text file extracted ${text.length} chars`);
      return text;
    }
    console.log(`${LOG_PREFIX} Unsupported file type: ${file.mimeType}`);
  } catch (error) {
    console.error(`${LOG_PREFIX} File extraction failed:`, error);
  }
  return '';
}

export class AiCommandService {
  async generateFlashcards(text: string, file: { data: string; mimeType: string } | undefined, ctx: RequestContext): Promise<FlashcardGenResult> {
    console.log(`${LOG_PREFIX} generateFlashcards called, text="${text.slice(0, 100)}", hasFile=${!!file}`);

    let prompt = text;
    if (file) {
      const extracted = await extractFileContent(file);
      if (extracted) {
        prompt = `${text}\n\nFile content:\n${extracted}`;
        console.log(`${LOG_PREFIX} Prompt with file content: ${prompt.length} chars`);
      } else {
        console.log(`${LOG_PREFIX} No content extracted from file, using original text only`);
      }
    }

    console.log(`${LOG_PREFIX} Calling LLM with tool_choice=generate_flashcards`);
    const response = await callLLM(
      {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        tools: [GENERATE_FLASHCARDS_TOOL],
        toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
      },
      ctx,
    );

    console.log(`${LOG_PREFIX} LLM response: content="${response.content.slice(0, 200)}", toolCalls=${response.toolCalls?.length ?? 0}`);

    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls.find((tc) => tc.function.name === 'generate_flashcards');
      if (toolCall) {
        console.log(`${LOG_PREFIX} Tool call arguments: ${toolCall.function.arguments.slice(0, 500)}`);
        const args = JSON.parse(toolCall.function.arguments);
        const flashcards = parseFlashcards(args.flashcards);
        console.log(`${LOG_PREFIX} Parsed ${flashcards.length} flashcards, deckName="${args.deck_name}"`);
        return {
          type: 'flashcards',
          deckName: args.deck_name || 'AI Generated Flashcards',
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

  async chat(text: string, file: { data: string; mimeType: string } | undefined, ctx: RequestContext): Promise<FlashcardGenResult | ChatResult> {
    const isFlashcard = hasFlashcardKeyword(text);
    console.log(`${LOG_PREFIX} chat called, text="${text.slice(0, 100)}", hasFile=${!!file}, flashcardKeyword=${isFlashcard}`);

    if (isFlashcard) {
      return this.generateFlashcards(text, file, ctx);
    }

    let prompt = text;
    if (file) {
      const extracted = await extractFileContent(file);
      if (extracted) {
        prompt = `${text}\n\nFile content:\n${extracted}`;
      }
    }

    console.log(`${LOG_PREFIX} Calling LLM with tool_choice=auto`);
    const response = await callLLM(
      {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        tools: [GENERATE_FLASHCARDS_TOOL],
        toolChoice: 'auto',
      },
      ctx,
    );

    console.log(`${LOG_PREFIX} LLM response: content="${response.content.slice(0, 200)}", toolCalls=${response.toolCalls?.length ?? 0}`);

    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls.find((tc) => tc.function.name === 'generate_flashcards');
      if (toolCall) {
        console.log(`${LOG_PREFIX} Tool call arguments: ${toolCall.function.arguments.slice(0, 500)}`);
        const args = JSON.parse(toolCall.function.arguments);
        const flashcards = parseFlashcards(args.flashcards);
        console.log(`${LOG_PREFIX} Parsed ${flashcards.length} flashcards, deckName="${args.deck_name}"`);
        return {
          type: 'flashcards',
          deckName: args.deck_name || 'AI Generated Flashcards',
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
