function qwenHost(hostname: string): boolean {
  return /^(?:dashscope(?:-intl)?\.aliyuncs\.com|[^.]+\.[^.]+\.maas\.aliyuncs\.com)$/iu
    .test(hostname);
}

export function qwenCoordinateOcrEndpoint(apiBaseUrl: string): string | undefined {
  try {
    const url = new URL(apiBaseUrl);
    if (url.protocol !== 'https:' || !qwenHost(url.hostname)) return undefined;
    const basePath = url.pathname.replace(/\/+$/u, '');
    if (!basePath.endsWith('/compatible-mode/v1')) return undefined;
    url.pathname = `${basePath.slice(0, -'/compatible-mode/v1'.length)}/api/v1/services/aigc/multimodal-generation/generation`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return undefined;
  }
}

export function supportsQwenCoordinateOcr(apiBaseUrl: string): boolean {
  return Boolean(qwenCoordinateOcrEndpoint(apiBaseUrl));
}
