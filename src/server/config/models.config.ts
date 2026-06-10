export interface ModelsConfig {
  provider: string | undefined;
  apiKey: string | undefined;
  baseUrl: string | undefined;
  modelName: string | undefined;
}

export function getModelsConfig(): ModelsConfig {
  return {
    provider: process.env.LLM_PROVIDER || undefined,
    apiKey: process.env.LLM_API_KEY || undefined,
    baseUrl: process.env.LLM_BASE_URL || undefined,
    modelName: process.env.LLM_MODEL_NAME || undefined,
  };
}
