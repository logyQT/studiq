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

export type LLMGatewayRequest = {
  prompt: string;
  systemPrompt?: string;
  file?: { data: string; mimeType: string };
  provider?: 'openai' | 'ollama';
  model?: string;
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
  tools?: ToolDefinition[];
  toolChoice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  provider: string;
  model: string;
};

export type LLMGatewayResponse = {
  content: string;
  toolCalls?: ToolCall[];
  usage: TokenUsage;
};

export type GatewayStreamCallbacks = {
  onToken: (token: string) => void;
};
