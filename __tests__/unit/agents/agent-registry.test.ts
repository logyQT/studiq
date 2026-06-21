import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/zod', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/zod')>();
  return { ...actual, registry: { register: vi.fn() } };
});

import { AgentRegistry } from '@/server/agents/agent-registry';
import { GeneralAgent } from '@/server/agents/general.agent';
import { FlashcardAgent } from '@/server/agents/flashcard.agent';

describe('AgentRegistry', () => {
  let registry: AgentRegistry;

  beforeEach(() => {
    vi.restoreAllMocks();
    registry = new AgentRegistry();
  });

  describe('get', () => {
    it('returns GeneralAgent for "general"', () => {
      const agent = registry.get('general');
      expect(agent).toBeInstanceOf(GeneralAgent);
    });

    it('returns FlashcardAgent for "flashcard"', () => {
      const agent = registry.get('flashcard');
      expect(agent).toBeInstanceOf(FlashcardAgent);
    });

    it('returns undefined for an unknown name', () => {
      const agent = registry.get('unknown');
      expect(agent).toBeUndefined();
    });
  });

  describe('getAll', () => {
    it('returns all registered agent names sorted', () => {
      const names = registry.getAll();
      expect(names).toEqual(['flashcard', 'general']);
    });
  });

  describe('register', () => {
    it('adds a new agent making it accessible via get', () => {
      const mockAgent = { name: 'custom', systemPrompt: 'test' } as any;
      registry.register(mockAgent);
      expect(registry.get('custom')).toBe(mockAgent);
    });
  });

  describe('getModelConfig', () => {
    it('returns model config for flashcard agent', () => {
      const config = registry.getModelConfig('flashcard');
      expect(config).toEqual({
        provider: 'opencode',
        model: 'mimo-v2.5',
        maxTokens: 8192,
      });
    });

    it('returns empty object for unknown agent', () => {
      const config = registry.getModelConfig('unknown');
      expect(config).toEqual({});
    });
  });
});
