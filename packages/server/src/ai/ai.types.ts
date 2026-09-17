export type ToolDefinition = {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type ToolCall = {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
};

export type AgentLLMConfig = {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  maxTokens?: number;
  reasoningEffort?: 'low' | 'medium' | 'high';
  contextWindow?: number;
};

export type LLMGatewayRequest = {
  prompt: string;
  systemPrompt?: string;
  file?: { data: string; mimeType: string };
  responseFormat?: 'text' | 'json';
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  onRetry?: (attempt: number, maxRetries: number, delayMs: number) => void;
  onToken?: (token: string) => void;
  onReasoningToken?: (token: string) => void;
} & AgentLLMConfig;

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
};

export type LLMGatewayResponse = {
  content: string;
  reasoning?: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
};

export type GatewayStreamCallbacks = {
  onToken: (token: string) => void;
  onReasoning?: (text: string) => void;
};
