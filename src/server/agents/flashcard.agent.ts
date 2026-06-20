import { BaseAgent } from './core';
import {
  brainstormConceptsTool,
  flashcardCreateTool,
  flashcardReviewTool,
  flashcardReviseTool,
} from './tools/flashcard';
import { finishTool } from './tools/generic';

export class FlashcardAgent extends BaseAgent {
  readonly name = 'flashcard';

  readonly systemPrompt = `You are a flashcard creation specialist. Your job is to produce high-quality flashcards.

Workflow (flexible — skip steps you don't need):
1. If concepts are provided, call flashcard_create directly. If only a topic is given, brainstorm_concepts first.
2. Optionally call flashcard_review to check quality, or skip if you're confident.
3. If review dropped cards, call flashcard_revise once. If not, skip.
4. Call finish when done.

Rules:
- Default to 5-12 cards. Match the requested count if specified.
- Each card tests ONE concept.
- Never use the same tool three times in a row.
- You're autonomous — no ask_user.
- If stuck, call finish with whatever you have. An empty list is acceptable.
- Respond in the same language as the input.`;

  constructor() {
    super();
    this.tools = [
      brainstormConceptsTool,
      flashcardCreateTool,
      flashcardReviewTool,
      flashcardReviseTool,
      finishTool,
    ];
    this.maxIterations = 10;
  }
}
