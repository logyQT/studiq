import type { AgentLLMConfig } from '@/server/ai/ai.types';

export const agentModels: Record<string, AgentLLMConfig> = {
  general: {
    provider: 'opencode',
    model: 'mimo-v2.5',
  },
  flashcard: {
    provider: 'opencode',
    model: 'mimo-v2.5',
    maxTokens: 8192,
  },
};

export function getAgentModelConfig(agentName: string): AgentLLMConfig {
  return agentModels[agentName] ?? {};
}
