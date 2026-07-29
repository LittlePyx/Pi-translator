export interface ApiPreset {
  id: string;
  name: string;
  apiBaseUrl: string;
  model: string;
  keyHint?: string;
}

export const API_PRESETS: ApiPreset[] = [
  {
    id: 'qwen',
    name: 'Qwen / 阿里云百炼',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    keyHint: 'API Key 与地域需要匹配；此预设使用中国内地（北京）兼容地址。',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter（聚合模型服务）',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    model: '~openai/gpt-latest',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地模型）',
    apiBaseUrl: 'http://localhost:11434/v1',
    model: '',
    keyHint: '本机 Ollama 可填写 ollama 作为 API Key',
  },
];
