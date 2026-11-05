export interface ApiPreset {
  id: string;
  name: string;
  apiBaseUrl: string;
  model: string;
  keyHint?: string;
  keyUrl?: string;
}

export const API_PRESETS: ApiPreset[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    apiBaseUrl: 'https://api.deepseek.com',
    model: 'deepseek-v4-flash',
    keyHint: '使用 DeepSeek 官方平台签发的 Key。若 Key 来自阿里云或其他平台，请选择签发 Key 的服务商，再选择 DeepSeek 模型。',
    keyUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'qwen',
    name: '阿里云百炼 / Qwen',
    apiBaseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.7-plus',
    keyHint: '默认北京地域；Key 与 API 地址须匹配。其他地域或业务空间请填写对应地址。',
    keyUrl: 'https://bailian.console.aliyun.com/?apiKey=1#/api-key',
  },
  {
    id: 'openai',
    name: 'OpenAI / GPT 官方',
    apiBaseUrl: 'https://api.openai.com/v1',
    model: '',
    keyHint: '使用 OpenAI API Key；ChatGPT 订阅不代替 API 配置。连接后选择此接口返回的 GPT 模型，也可手动填写模型 ID。',
    keyUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    name: 'Anthropic / Claude 官方',
    apiBaseUrl: 'https://api.anthropic.com/v1',
    model: '',
    keyHint: '使用 Anthropic API Key，通过官方 OpenAI 兼容接口调用 Claude。若无法读取模型列表，可手动填写 Claude 模型 ID 并验证。',
    keyUrl: 'https://platform.claude.com/settings/keys',
  },
  {
    id: 'gemini',
    name: 'Google / Gemini 官方',
    apiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: '',
    keyHint: '使用 Google AI Studio 的 Gemini API Key。连接后选择模型；不同地域和账号的可用范围可能不同。',
    keyUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'openrouter',
    name: 'OpenRouter / 多家模型',
    apiBaseUrl: 'https://openrouter.ai/api/v1',
    model: '~openai/gpt-latest',
    keyHint: '使用 OpenRouter Key，可选择平台提供的 GPT、Claude、Gemini、Qwen、DeepSeek、Kimi、GLM 等模型；列表不代表全部模型已通过调用验证。',
    keyUrl: 'https://openrouter.ai/settings/keys',
  },
  {
    id: 'ollama',
    name: 'Ollama（本地模型）',
    apiBaseUrl: 'http://localhost:11434/v1',
    model: '',
    keyHint: '本机 Ollama 可填写 ollama 作为 API Key',
  },
];
