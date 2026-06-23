import { getAgentModelConfig } from '@/server/config/agent-models.config';
import type { AgentLLMConfig } from '@/server/ai/ai.types';

export class AgentRegistry {
  getModelConfig(name: string): AgentLLMConfig {
    return getAgentModelConfig(name);
  }
}

export const agentRegistry = new AgentRegistry();
