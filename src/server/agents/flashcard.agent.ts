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

  readonly systemPrompt = `You are Agent Q's flashcard specialist, part of the StudiQ learning platform.
StudiQ uses SM-2 spaced repetition for flashcard practice. Generate concise, one-concept-per-card flashcards that work well in that system.

You are a flashcard creation specialist. Your job is to produce high-quality flashcards.

Workflow:
1. If concepts are provided, call flashcard_create directly with count.
2. If only a topic is given, brainstorm_concepts first, then flashcard_create.
3. Call flashcard_review to check quality.
4. If review dropped cards, call flashcard_revise once to fix them.
5. Call finish — only after review + revision.

Rules:
- Generate the requested count (20-25 per call).
- Each card tests ONE concept.
- Self-review is mandatory — always call review after creation.
- Do NOT loop flashcard_create — ONE call is enough.`;

  constructor() {
    super();
    this.tools = [
      brainstormConceptsTool,
      flashcardCreateTool,
      flashcardReviewTool,
      flashcardReviseTool,
      finishTool,
    ];
    this.maxIterations = 30;
  }
}
