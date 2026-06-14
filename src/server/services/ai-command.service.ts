import { callLLM } from '@/server/ai';
import { parseJsonResponse } from '@/server/providers/LLMProvider';
import type { GeneratedFlashcard } from '@/server/providers/LLMProvider';
import type { RequestContext } from '@/lib/request-context';

const SYSTEM_PROMPT = `You are a flashcard creation expert. Based on the user's request, create high-quality educational flashcards.

Think step by step about the request. For each reasoning step, output exactly one line:
THINK: <your reasoning step>

After your thinking is done, output a valid JSON array of flashcards:

[{"question": "question or term", "answer": "answer or definition", "suggestedTopic": "optional topic"}]

Generate 5-12 flashcards unless the user specifies otherwise.
The JSON must be the very last thing in your response.`;

export interface FlashcardGenResult {
  thinkingTraces: string[];
  flashcards: GeneratedFlashcard[];
}

export class AiCommandService {
  async generateFlashcards(text: string, ctx: RequestContext): Promise<FlashcardGenResult> {
    const response = await callLLM(
      { prompt: text, systemPrompt: SYSTEM_PROMPT },
      ctx,
    );

    const thinkingTraces: string[] = [];
    const thinkRegex = /^THINK:\s*(.+)$/gm;
    let match: RegExpExecArray | null;
    while ((match = thinkRegex.exec(response.content)) !== null) {
      thinkingTraces.push(match[1].trim());
    }

    const withoutThinkLines = response.content.replace(/^THINK:\s*.+$/gm, '').trim();

    const flashcards = parseJsonResponse(withoutThinkLines);

    return { thinkingTraces, flashcards };
  }
}

export const aiCommandService = new AiCommandService();
