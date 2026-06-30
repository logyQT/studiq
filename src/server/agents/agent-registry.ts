import type { AgentLLMConfig } from '@/server/ai/ai.types';
import { getAgentModelConfig } from '@/server/config/agent-models.config';
import type { BaseAgent } from './core/base.agent';
import { FlashcardAgent } from './flashcard.agent';
import { GeneralAgent } from './general.agent';

export class AgentRegistry {
  private agents = new Map<string, BaseAgent>();

  constructor() {
    this.register(new GeneralAgent());
    this.register(new FlashcardAgent());
  }

  register(agent: BaseAgent): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): BaseAgent | undefined {
    return this.agents.get(name);
  }

  getAll(): string[] {
    return Array.from(this.agents.keys()).sort();
  }

  getModelConfig(name: string): AgentLLMConfig {
    return getAgentModelConfig(name);
  }
}

export const agentRegistry = new AgentRegistry();
