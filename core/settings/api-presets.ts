export interface ApiPreset {
  id: string;
  name: string;
  apiBaseUrl: string;
  model: string;
  keyHint?: string;
}

export const API_PRESETS: ApiPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    model: '~openai/gpt-latest',
  },
  {
    id: 'ollama',
    name: 'Ollama（本机）',
    apiBaseUrl: 'http://localhost:11434/v1',
    model: '',
    keyHint: '本机 Ollama 可填写 ollama 作为 API Key',
  },
];
