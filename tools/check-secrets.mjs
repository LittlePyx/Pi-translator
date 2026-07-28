import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const EXCLUDED_DIRECTORIES = new Set([
  '.git',
  '.output',
  '.wxt',
  'node_modules',
  'playwright-report',
  'test-results',
]);
const BINARY_EXTENSIONS = new Set([
  '.7z', '.gif', '.ico', '.jpeg', '.jpg', '.pdf', '.png', '.webp', '.zip',
]);
const PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.flatMap((entry) => {
    if (entry.isSymbolicLink()) return [];
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      return EXCLUDED_DIRECTORIES.has(entry.name) ? [] : [files(target)];
    }
    return entry.isFile() ? [[target]] : [];
  }));
  return nested.flat();
}

const findings = [];
for (const file of await files(ROOT)) {
  if (BINARY_EXTENSIONS.has(path.extname(file).toLowerCase())) continue;
  if ((await stat(file)).size > MAX_FILE_BYTES) continue;
  const value = await readFile(file, 'utf8').catch(() => '');
  if (value.includes('\0')) continue;
  for (const pattern of PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(value))) {
      const line = value.slice(0, match.index).split(/\r?\n/).length;
      findings.push(`${path.relative(ROOT, file)}:${line}`);
    }
  }
}

if (findings.length) {
  console.error('Potential secret patterns found (contents intentionally hidden):');
  for (const finding of findings) console.error(`- ${finding}`);
  process.exitCode = 1;
} else {
  console.log('No API key or private-key patterns detected.');
}
