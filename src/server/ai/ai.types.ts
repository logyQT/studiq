export type LLMGatewayRequest = {
  prompt: string;
  systemPrompt?: string;
  file?: { data: string; mimeType: string };
  provider?: 'openai' | 'ollama';
  model?: string;
  responseFormat?: 'text' | 'json';
  maxTokens?: number;
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
  usage: TokenUsage;
};

export type GatewayStreamCallbacks = {
  onToken: (token: string) => void;
};
