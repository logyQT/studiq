import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockExecute = vi.hoisted(() => vi.fn().mockResolvedValue({ type: 'chat', content: 'Test result' }));

vi.mock('@/server/agents/agent-registry', () => ({
  agentRegistry: {
    get: vi.fn().mockReturnValue({ name: 'general', execute: mockExecute }),
    getModelConfig: vi.fn().mockReturnValue({}),
    getAll: vi.fn().mockReturnValue(['general', 'flashcard']),
  },
}));

vi.mock('@/server/ai/llm-gateway', () => ({
  callLLM: vi.fn(),
}));

import { agentService } from '@/server/services/agent.service';
import { agentRegistry as mockedRegistry } from '@/server/agents/agent-registry';
import type { AgentCallbacks, AgentResult } from '@/server/agents/tools/types';

describe('AgentService', () => {
  let mockCtx: any;
  let mockCallbacks: AgentCallbacks;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCtx = { userId: 'user-1', organizationId: null, role: 'STUDENT', url: '/api/v1/ai/chat', method: 'POST' };
    mockCallbacks = {
      onStep: vi.fn(),
      onToolCall: vi.fn(),
      onToolResult: vi.fn(),
      onThinking: vi.fn(),
      onFlashcards: vi.fn(),
      onComplete: vi.fn(),
      onError: vi.fn(),
    };
  });

  describe('process', () => {
    it('returns an AgentResult', async () => {
      const result: AgentResult = await agentService.process({ text: 'Hello' }, mockCtx, mockCallbacks);
      expect(result).toBeDefined();
      expect(result.type).toBe('chat');
    });

    it('passes the task text to agent.execute', async () => {
      await agentService.process({ text: 'Create flashcards about history' }, mockCtx, mockCallbacks);
      expect(mockExecute).toHaveBeenCalledWith('Create flashcards about history', expect.anything());
    });

    it('includes callbacks in the ToolContext', async () => {
      await agentService.process({ text: 'Hello' }, mockCtx, mockCallbacks);
      const toolCtx = mockExecute.mock.calls[0][1];
      expect(toolCtx.callbacks).toBe(mockCallbacks);
    });

    it('includes the task text in ToolContext state', async () => {
      await agentService.process({ text: 'Test task' }, mockCtx, mockCallbacks);
      const toolCtx = mockExecute.mock.calls[0][1];
      expect(toolCtx.state.text).toBe('Test task');
    });

    it('agentRegistry.get delegates to the singleton', async () => {
      await agentService.process({ text: 'Hello' }, mockCtx, mockCallbacks);
      const toolCtx = mockExecute.mock.calls[0][1];
      const result = toolCtx.agentRegistry.get('flashcard');
      expect(result).toBeDefined();
    });

    it('agentRegistry.getAll returns available agent names', async () => {
      await agentService.process({ text: 'Hello' }, mockCtx, mockCallbacks);
      const toolCtx = mockExecute.mock.calls[0][1];
      const names = toolCtx.agentRegistry.getAll();
      expect(names).toEqual(['general', 'flashcard']);
    });

    it('returns type error when general agent is missing from registry', async () => {
      vi.mocked(mockedRegistry.get).mockReturnValue(undefined);

      const result = await agentService.process({ text: 'Hello' }, mockCtx, mockCallbacks);
      expect(result.type).toBe('error');
      if (result.type === 'error') {
        expect(result.error).toBe('General agent not found.');
      }
    });
  });
});
