import type { AgentLLMConfig } from '@/server/ai/ai.types';

export const agentModels: Record<string, AgentLLMConfig> = {
  general: {
    provider: 'opencode',
    model: 'mimo-v2.5',
    maxTokens: 16384,
    reasoningEffort: 'medium',
    contextWindow: 128000,
  },
  flashcard: {
    provider: 'opencode',
    model: 'mimo-v2.5',
    maxTokens: 16384,
    reasoningEffort: 'high',
    contextWindow: 128000,
  },
};

export function getAgentModelConfig(agentName: string): AgentLLMConfig {
  return agentModels[agentName] ?? {};
}
