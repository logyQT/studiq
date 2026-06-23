import { log } from '@/lib/logger';
import { chatModel } from '@/server/ai/model';
import type { RequestContext } from '@/lib/request-context';
import {
  FLASHCARD_MAX_TOKENS,
  FlashcardItem,
  FlashcardGenResult,
  ChatResult,
  ThinkingCallbacks,
  hasFlashcardKeyword,
  parseFlashcards,
  parseToolCallArgs,
  startSlowTimers,
  clearSlowTimers,
  withRetry,
  extractFileContent,
} from './ai-utils';
import { repairJson } from '@/server/services/ai-utils';
import {
  SYSTEM_PROMPT,
  GENERATE_MATERIAL_PROMPT,
  ANALYZE_SYSTEM_PROMPT,
  EXTRACT_TERMS_TOOL,
  GENERATE_FROM_TERMS_SYSTEM_PROMPT,
  REVIEW_SYSTEM_PROMPT,
  REVIEW_CARDS_TOOL,
  GENERATE_FLASHCARDS_TOOL,
} from './ai-prompts';

interface ExtractedTerm {
  term: string;
  definition: string;
  context?: string;
  category?: string;
}

export class AiCommandService {
  async generateFlashcards(text: string, file: { data: string; mimeType: string } | undefined, conversationId: string | undefined, ctx: RequestContext, callbacks?: ThinkingCallbacks): Promise<FlashcardGenResult> {
    const pipelineStart = Date.now();
    log.ai.info('generateFlashcards called', { metadata: { text: text.slice(0, 100), hasFile: !!file, conversationId: conversationId ?? 'none' } });

    let prompt = text;
    const extracted = await extractFileContent(file, conversationId);
    if (extracted) {
      prompt = `${text}\n\nFile content:\n${extracted}`;
      log.ai.info(`Prompt with file content: ${prompt.length} chars`);
    } else {
      log.ai.info('No source material provided');
    }

    // Step 0: Generate material when no source provided
    if (!extracted) {
      log.ai.info('=== Step 0/3: Generate Material ===');
      callbacks?.onThink('Collecting knowledge about the topic...');
      const generated = await withRetry(
        () => this.generateMaterial(text, ctx, callbacks),
        (result) => result.length === 0,
        2,
        'Material collection',
        callbacks,
      );
      if (generated) {
        prompt = `${text}\n\nGenerated educational content:\n${generated}`;
        log.ai.info(`Step 0 complete, generated material: ${generated.length} chars`);
        callbacks?.onThink(`Collected ${generated.length.toLocaleString()} words of study material`);
      } else {
        log.ai.info('Step 0 returned empty, proceeding with user request only');
        callbacks?.onThink('Proceeding with provided context');
        prompt = text;
      }
    }

    // Step 1: Analyze — extract atomic concepts
    log.ai.info('=== Step 1/3: Analyze ===');
    callbacks?.onThink('Identifying key concepts and terms...');
    const terms = await withRetry(
      () => this.analyzeContent(prompt, ctx, callbacks),
      (result) => result.length === 0,
      2,
      'Concept extraction',
      callbacks,
    );
    if (terms.length === 0) {
      log.ai.warn(`Pipeline aborted at Step 1: no terms extracted (${Date.now() - pipelineStart}ms total)`);
      callbacks?.onThink('Could not identify key concepts after multiple attempts');
      return {
        type: 'flashcards',
        deckName: 'AI Generated Flashcards',
        flashcards: [],
        content: 'Could not extract concepts from the provided content.',
      };
    }
    const termNames = terms.slice(0, 3).map((t) => t.term).join(', ');
    callbacks?.onThink(`Found ${terms.length} key terms: ${termNames}${terms.length > 3 ? '...' : ''}`);

    // Step 2: Generate — create flashcards from terms
    log.ai.info('=== Step 2/3: Generate ===');
    callbacks?.onThink(`Building flashcards from ${terms.length} key terms...`);
    const { deckName, flashcards: rawCards } = await withRetry(
      () => this.generateFromTerms(terms, text, ctx, callbacks),
      (result) => result.flashcards.length === 0,
      2,
      'Flashcard generation',
      callbacks,
    );
    if (rawCards.length === 0) {
      log.ai.warn(`Pipeline aborted at Step 2: no flashcards generated (${Date.now() - pipelineStart}ms total)`);
      callbacks?.onThink('Could not generate flashcards after multiple attempts');
      return {
        type: 'flashcards',
        deckName: 'AI Generated Flashcards',
        flashcards: [],
      };
    }
    callbacks?.onThink(`Created ${rawCards.length} flashcards in "${deckName}"`);

    // Step 3: Review — quality gate, drop bad cards
    log.ai.info('=== Step 3/3: Review ===');
    callbacks?.onThink('Reviewing flashcards for quality...');
    const { kept, reasons: _reasons } = await this.reviewFlashcards(rawCards, ctx);
    const reviewedCards = kept.map((i) => rawCards[i]).filter(Boolean);
    const elapsed = Date.now() - pipelineStart;
    const droppedCount = rawCards.length - reviewedCards.length;
    log.ai.info(`Pipeline complete: ${reviewedCards.length}/${rawCards.length} cards survived review`, { durationMs: elapsed });
    if (droppedCount > 0) {
      callbacks?.onThink(`Kept ${reviewedCards.length} high-quality cards, dropped ${droppedCount}`);
    } else {
      callbacks?.onThink(`All ${reviewedCards.length} cards passed quality review`);
    }

    return {
      type: 'flashcards',
      deckName,
      flashcards: reviewedCards,
    };
  }

  private async generateMaterial(topic: string, ctx: RequestContext, callbacks?: ThinkingCallbacks): Promise<string> {
    log.ai.info('[Step 0] generateMaterial called', { metadata: { topic: topic.slice(0, 100) } });
    const start = Date.now();
    const timers = startSlowTimers(callbacks);

    let response;
    try {
      response = await this.callLLM(
        {
          prompt: topic,
          systemPrompt: GENERATE_MATERIAL_PROMPT,
          maxTokens: 8192,
        },
        ctx,
      );
    } catch (error) {
      log.ai.error('[Step 0] LLM call failed', { metadata: { error } });
      return '';
    } finally {
      clearSlowTimers(timers);
    }

    log.ai.info('[Step 0] LLM responded', { durationMs: Date.now() - start, metadata: { contentLength: response.content.length } });
    if (response.content.length > 0) {
      log.ai.info('[Step 0] Content preview', { metadata: { preview: response.content.slice(0, 200) } });
    }

    return response.content;
  }

  private async analyzeContent(material: string, ctx: RequestContext, callbacks?: ThinkingCallbacks): Promise<ExtractedTerm[]> {
    log.ai.info('[Step 1] analyzeContent called', { metadata: { materialLength: material.length } });
    const start = Date.now();
    const timers = startSlowTimers(callbacks);

    let response;
    try {
      response = await this.callLLM(
        {
          prompt: material,
          systemPrompt: ANALYZE_SYSTEM_PROMPT,
          tools: [EXTRACT_TERMS_TOOL],
          toolChoice: { type: 'function', function: { name: 'extract_terms' } },
          maxTokens: 8192,
        },
        ctx,
      );
    } catch (error) {
      log.ai.error('[Step 1] LLM call failed', { metadata: { error } });
      return [];
    } finally {
      clearSlowTimers(timers);
    }

    log.ai.info('[Step 1] LLM responded', { durationMs: Date.now() - start, metadata: { content: response.content.slice(0, 200), toolCalls: response.toolCalls?.length ?? 0 } });

    const args = parseToolCallArgs<{ terms: ExtractedTerm[] }>(response.toolCalls, 'extract_terms');
    if (!args) {
      log.ai.warn('[Step 1] No extract_terms tool call found');
      return [];
    }
    if (!args.terms) {
      log.ai.warn(`[Step 1] Tool call missing "terms" field`, { metadata: { keys: Object.keys(args).join(', ') } });
      return [];
    }

    const valid = args.terms.filter((t) => t.term && t.definition);
    const dropped = args.terms.length - valid.length;
    log.ai.info(`[Step 1] Parsed ${args.terms.length} raw terms, ${valid.length} valid, ${dropped} dropped (missing term or definition)`);
    if (valid.length > 0) {
      log.ai.info(`[Step 1] Sample terms: ${valid.slice(0, 3).map((t) => `"${t.term}"`).join(', ')}${valid.length > 3 ? ` (+${valid.length - 3} more)` : ''}`);
    }

    return valid;
  }

  private async generateFromTerms(terms: ExtractedTerm[], originalRequest: string, ctx: RequestContext, callbacks?: ThinkingCallbacks): Promise<{ deckName: string; flashcards: FlashcardItem[] }> {
    const termsJson = JSON.stringify(terms, null, 2);
    const prompt = `User request: ${originalRequest}\n\nExtracted terms:\n${termsJson}`;
    log.ai.info('[Step 2] generateFromTerms called', { metadata: { termCount: terms.length, promptLength: prompt.length } });
    const start = Date.now();
    const timers = startSlowTimers(callbacks);

    let response;
    try {
      response = await this.callLLM(
        {
          prompt,
          systemPrompt: GENERATE_FROM_TERMS_SYSTEM_PROMPT,
          tools: [GENERATE_FLASHCARDS_TOOL],
          toolChoice: { type: 'function', function: { name: 'generate_flashcards' } },
          maxTokens: FLASHCARD_MAX_TOKENS,
        },
        ctx,
      );
    } catch (error) {
      log.ai.error('[Step 2] LLM call failed', { metadata: { error } });
      return { deckName: 'AI Generated Flashcards', flashcards: [] };
    } finally {
      clearSlowTimers(timers);
    }

    log.ai.info('[Step 2] LLM responded', { durationMs: Date.now() - start, metadata: { content: response.content.slice(0, 200), toolCalls: response.toolCalls?.length ?? 0 } });

    const args = parseToolCallArgs<{ deck_name?: string; flashcards: unknown[] }>(response.toolCalls, 'generate_flashcards');
    if (!args) {
      log.ai.warn('[Step 2] No generate_flashcards tool call found');
      return { deckName: 'AI Generated Flashcards', flashcards: [] };
    }
    if (!args.flashcards) {
      log.ai.warn('[Step 2] Tool call missing "flashcards" field', { metadata: { keys: Object.keys(args).join(', ') } });
      return { deckName: 'AI Generated Flashcards', flashcards: [] };
    }

    const cards = parseFlashcards(args.flashcards);
    const deckName = String(args.deck_name || 'AI Generated Flashcards');
    log.ai.info(`[Step 2] Parsed ${cards.length} flashcards, deckName="${deckName}"`);
    if (cards.length > 0) {
      log.ai.info(`[Step 2] Sample cards: ${cards.slice(0, 2).map((c) => `Q:"${c.front.slice(0, 60)}..." A:"${c.back.slice(0, 60)}..."`).join(' | ')}`);
    }

    return { deckName, flashcards: cards };
  }

  private async reviewFlashcards(cards: FlashcardItem[], ctx: RequestContext): Promise<{ kept: number[]; reasons: Record<string, string> }> {
    const cardsJson = JSON.stringify(cards.map((c, i) => ({ index: i, front: c.front, back: c.back, topic: c.topic })), null, 2);
    log.ai.info('[Step 3] reviewFlashcards called', { metadata: { cardCount: cards.length, promptLength: cardsJson.length } });
    const start = Date.now();

    let response;
    try {
      response = await this.callLLM(
        {
          prompt: cardsJson,
          systemPrompt: REVIEW_SYSTEM_PROMPT,
          tools: [REVIEW_CARDS_TOOL],
          toolChoice: { type: 'function', function: { name: 'review_cards' } },
          maxTokens: 2048,
        },
        ctx,
      );
    } catch (error) {
      log.ai.error('[Step 3] LLM call failed', { metadata: { error } });
      log.ai.warn(`[Step 3] Keeping all ${cards.length} cards as fallback`);
      return { kept: cards.map((_, i) => i), reasons: {} };
    }

    log.ai.info('[Step 3] LLM responded', { durationMs: Date.now() - start, metadata: { content: response.content.slice(0, 200), toolCalls: response.toolCalls?.length ?? 0 } });

    const args = parseToolCallArgs<{ kept: number[]; reasons?: Record<string, string> }>(response.toolCalls, 'review_cards');
    if (!args) {
      log.ai.warn(`[Step 3] No review_cards tool call found, keeping all ${cards.length} cards`);
      return { kept: cards.map((_, i) => i), reasons: {} };
    }

    const keptIndices = args.kept ?? [];
    const reasons = args.reasons ?? {};
    const droppedCount = cards.length - keptIndices.length;
    log.ai.info(`[Step 3] Review result: keeping ${keptIndices.length}/${cards.length}, dropping ${droppedCount}`);
    if (droppedCount > 0) {
      for (const [idx, reason] of Object.entries(reasons)) {
        const card = cards[Number(idx)];
        log.ai.info(`[Step 3] Drop card #${idx}: Q="${card?.front?.slice(0, 50)}..." reason="${reason}"`);
      }
    }

    return { kept: keptIndices, reasons };
  }

  async chat(text: string, file: { data: string; mimeType: string } | undefined, conversationId: string | undefined, ctx: RequestContext, callbacks?: ThinkingCallbacks): Promise<FlashcardGenResult | ChatResult> {
    const isFlashcard = hasFlashcardKeyword(text);
    log.ai.info('chat called', { metadata: { text: text.slice(0, 100), hasFile: !!file, flashcardKeyword: isFlashcard, conversationId: conversationId ?? 'none' } });

    if (isFlashcard) {
      const result = await this.generateFlashcards(text, file, conversationId, ctx, callbacks);
      if (result.flashcards.length === 0 && result.content) {
        return { type: 'chat', content: result.content };
      }
      return result;
    }

    let prompt = text;
    const extracted = await extractFileContent(file, conversationId);
    if (extracted) {
      prompt = `${text}\n\nFile content:\n${extracted}`;
    }

    log.ai.info('Calling LLM with tool_choice=auto');
    const response = await this.callLLM(
        {
        prompt,
        systemPrompt: SYSTEM_PROMPT,
        tools: [GENERATE_FLASHCARDS_TOOL],
        toolChoice: 'auto',
        maxTokens: FLASHCARD_MAX_TOKENS,
      },
      ctx,
    );

    log.ai.info('LLM response', { metadata: { content: response.content.slice(0, 200), toolCalls: response.toolCalls?.length ?? 0 } });

    if (response.toolCalls && response.toolCalls.length > 0) {
      const toolCall = response.toolCalls.find((tc) => tc.function.name === 'generate_flashcards');
      if (toolCall) {
        log.ai.info('Tool call arguments', { metadata: { args: toolCall.function.arguments.slice(0, 500) } });
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(toolCall.function.arguments);
        } catch {
          try {
            const repaired = repairJson(toolCall.function.arguments);
            log.ai.warn('JSON parse failed, repaired', { metadata: { repaired: repaired.slice(0, 200) } });
            args = JSON.parse(repaired);
          } catch {
            log.ai.warn('Tool call args unrecoverable, falling back to text');
            return {
              type: 'chat',
              content: response.content,
            };
          }
        }
        const flashcards = parseFlashcards(args.flashcards);
        log.ai.info(`Parsed ${flashcards.length} flashcards, deckName="${args.deck_name}"`);
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

  private async callLLM(req: { prompt: string; systemPrompt?: string; maxTokens?: number; tools?: any[]; toolChoice?: any }, _ctx: RequestContext): Promise<{ content: string; toolCalls?: any[]; usage?: any }> {
    const { generateText } = await import('ai');
    const { text, toolCalls, usage } = await generateText({
      model: chatModel,
      system: req.systemPrompt,
      prompt: req.prompt,
      maxOutputTokens: req.maxTokens,
      tools: req.tools as any,
      toolChoice: req.toolChoice as any,
      maxRetries: 3,
    });
    return { content: text || '', toolCalls, usage };
  }
}

export const aiCommandService = new AiCommandService();
