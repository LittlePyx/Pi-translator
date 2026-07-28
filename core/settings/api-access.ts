const LOCAL_API_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('请填写 API Base URL。');

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error('API Base URL 格式不正确。');
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('API Base URL 不能包含账号、查询参数或锚点。');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_API_HOSTS.has(url.hostname))) {
    throw new Error('远程 API 必须使用 HTTPS；本机 localhost 服务可以使用 HTTP。');
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function apiEndpoint(baseUrl: string, resource: 'chat/completions' | 'models'): string {
  return `${normalizeApiBaseUrl(baseUrl)}/${resource}`;
}

export function apiOriginPattern(baseUrl: string): string {
  return `${new URL(normalizeApiBaseUrl(baseUrl)).origin}/*`;
}
