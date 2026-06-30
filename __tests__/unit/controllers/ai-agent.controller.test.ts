import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AgentCallbacks } from '@/server/agents/tools/types';

let capturedCallbacks: AgentCallbacks | undefined;

vi.mock('@/server/services/agent.service', () => ({
  agentService: {
    process: vi.fn().mockImplementation(async (_body: unknown, _ctx: unknown, callbacks: AgentCallbacks) => {
      capturedCallbacks = callbacks;
      return { type: 'chat', content: 'Default' };
    }),
  },
}));

import { aiAgentController, type AgentStreamCallbacks } from '@/server/controllers/ai-agent.controller';

describe('AiAgentController', () => {
  let mockCtx: { userId: string; organizationId: null; role: string; url: string; method: string };
  let mockCallbacks: AgentStreamCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedCallbacks = undefined;

    mockCtx = {
      userId: 'test-user-id',
      organizationId: null,
      role: 'student',
      url: 'http://localhost',
      method: 'POST',
    };

    mockCallbacks = {
      onThought: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onFlashcards: vi.fn(),
      onQuestion: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
  });

  describe('process', () => {
    it('calls onComplete with content when result type is chat', async () => {
      const { agentService } = await import('@/server/services/agent.service');
      vi.mocked(agentService.process).mockResolvedValueOnce({
        type: 'chat',
        content: 'Hello, world!',
      });

      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('Hello, world!');
    });

    it('calls onComplete with empty string when result type is flashcards', async () => {
      const { agentService } = await import('@/server/services/agent.service');
      vi.mocked(agentService.process).mockResolvedValueOnce({
        type: 'flashcards',
        deckName: 'Science Deck',
        flashcards: [{ front: 'Q', back: 'A' }],
      });

      await aiAgentController.process('Make flashcards', undefined, undefined, mockCtx, mockCallbacks);

      expect(mockCallbacks.onFlashcards).toHaveBeenCalledWith({
        deckName: 'Science Deck',
        flashcards: [{ front: 'Q', back: 'A' }],
      });
      expect(mockCallbacks.onComplete).toHaveBeenCalledWith('');
    });

    it('calls onError when result type is error', async () => {
      const { agentService } = await import('@/server/services/agent.service');
      vi.mocked(agentService.process).mockResolvedValueOnce({
        type: 'error',
        error: 'Something went wrong',
      });

      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith('Something went wrong');
    });

    it('catches exceptions and maps to onError', async () => {
      const { agentService } = await import('@/server/services/agent.service');
      vi.mocked(agentService.process).mockRejectedValueOnce(new Error('Boom'));

      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith('Boom');
    });

    it('catches non-Error exceptions and maps generic message to onError', async () => {
      const { agentService } = await import('@/server/services/agent.service');
      vi.mocked(agentService.process).mockRejectedValueOnce('string error');

      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      expect(mockCallbacks.onError).toHaveBeenCalledWith('Internal server error');
    });
  });

  describe('AgentCallbacks mapping', () => {
    it('onThought forwards to stream callback', async () => {
      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      capturedCallbacks?.onThought?.({ reasoning: 'I need to create flashcards.', step: 1, agent: 'general' });

      expect(mockCallbacks.onThought).toHaveBeenCalledWith({
        reasoning: 'I need to create flashcards.',
        step: 1,
        agent: 'general',
      });
    });

    it('onToolCall generates label and forwards to stream callback', async () => {
      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      capturedCallbacks?.onToolCall?.({ id: 'tc-0-0', tool: 'create_plan', args: { steps: [] } });

      expect(mockCallbacks.onToolCall).toHaveBeenCalledWith({
        id: 'tc-0-0',
        tool: 'create_plan',
        label: '📋 Creating execution plan...',
        args: { steps: [] },
      });
    });

    it('onToolResult generates label and forwards to stream callback', async () => {
      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      capturedCallbacks?.onToolResult?.({
        id: 'tc-0-0',
        tool: 'flashcard_create',
        result: { deckName: 'Test', flashcards: [{ front: 'Q', back: 'A' }] },
      });

      expect(mockCallbacks.onToolResult).toHaveBeenCalledWith({
        id: 'tc-0-0',
        tool: 'flashcard_create',
        label: '📇 Created 1 flashcards',
        result: { deckName: 'Test', flashcards: [{ front: 'Q', back: 'A' }] },
      });
    });

    it('onFlashcards forwards to stream callback', async () => {
      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      const data = { deckName: 'Test', flashcards: [{ front: 'Q', back: 'A' }] };
      capturedCallbacks?.onFlashcards?.(data);

      expect(mockCallbacks.onFlashcards).toHaveBeenCalledWith(data);
    });

    it('onError forwards to stream callback', async () => {
      await aiAgentController.process('Hi', undefined, undefined, mockCtx, mockCallbacks);

      capturedCallbacks?.onError?.('Agent error');

      expect(mockCallbacks.onError).toHaveBeenCalledWith('Agent error');
    });
  });
});
