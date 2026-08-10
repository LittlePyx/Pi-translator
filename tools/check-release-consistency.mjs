import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';

const ROOT = process.cwd();
const OUTPUT_DIRECTORY = path.join(ROOT, '.output');
const BUILD_DIRECTORY = path.join(OUTPUT_DIRECTORY, 'edge-mv3');
const FORBIDDEN_PATH_SEGMENTS = new Set([
  '.git',
  '.github',
  '.output',
  '.wxt',
  'node_modules',
  'playwright-report',
  'test-results',
  'tests',
  'tools',
]);
const REQUIRED_PACKAGE_FILES = new Set([
  'background.js',
  'manifest.json',
  'options.html',
  'pdf.html',
  'popup.html',
  'sidepanel.html',
]);

function fail(message) {
  throw new Error(message);
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function listFiles(directory, prefix = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail(`Symbolic links are not allowed in the build: ${path.join(prefix, entry.name)}`);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) names.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) names.push(relative);
  }
  return names.sort();
}

function findEndOfCentralDirectory(buffer) {
  const signature = 0x06054b50;
  const earliest = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= earliest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === signature) return offset;
  }
  fail('The Edge package is not a readable ZIP archive.');
}

function readZipEntries(buffer) {
  const endOffset = findEndOfCentralDirectory(buffer);
  const diskNumber = buffer.readUInt16LE(endOffset + 4);
  const centralDisk = buffer.readUInt16LE(endOffset + 6);
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralSize = buffer.readUInt32LE(endOffset + 12);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (diskNumber !== 0 || centralDisk !== 0) fail('Multi-disk ZIP archives are not supported.');
  if (centralOffset + centralSize > endOffset) fail('The ZIP central directory is out of bounds.');

  const entries = new Map();
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) fail(`Invalid ZIP central directory entry ${index + 1}.`);
    const compression = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const nameBuffer = buffer.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = nameBuffer.toString('utf8').replaceAll('\\', '/');
    if (entries.has(name)) fail(`Duplicate ZIP entry: ${name}`);
    entries.set(name, { compression, compressedSize, uncompressedSize, localOffset });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  if (cursor !== centralOffset + centralSize) fail('The ZIP central directory size does not match its entries.');
  return entries;
}

function extractZipEntry(buffer, entry) {
  if (buffer.readUInt32LE(entry.localOffset) !== 0x04034b50) fail('Invalid ZIP local file header.');
  const nameLength = buffer.readUInt16LE(entry.localOffset + 26);
  const extraLength = buffer.readUInt16LE(entry.localOffset + 28);
  const start = entry.localOffset + 30 + nameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  const value = entry.compression === 0
    ? compressed
    : entry.compression === 8
      ? inflateRawSync(compressed)
      : fail(`Unsupported ZIP compression method: ${entry.compression}`);
  if (value.length !== entry.uncompressedSize) fail('A ZIP entry has an invalid uncompressed size.');
  return value;
}

function validatePackagePaths(names) {
  for (const name of names) {
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name)) fail(`Unsafe ZIP path: ${name || '<empty>'}`);
    const segments = name.split('/');
    if (segments.some((segment) => segment === '..' || segment === '.')) fail(`Unsafe ZIP path: ${name}`);
    if (segments.some((segment) => FORBIDDEN_PATH_SEGMENTS.has(segment))) fail(`Forbidden ZIP path: ${name}`);
    if (segments.some((segment) => segment === '.env' || segment.startsWith('.env.'))) fail(`Environment file found in ZIP: ${name}`);
  }
}

function compareFileLists(buildFiles, packageFiles) {
  const buildSet = new Set(buildFiles);
  const packageSet = new Set(packageFiles);
  const missing = buildFiles.filter((name) => !packageSet.has(name));
  const unexpected = packageFiles.filter((name) => !buildSet.has(name));
  if (missing.length || unexpected.length) {
    const details = [
      ...missing.map((name) => `missing from ZIP: ${name}`),
      ...unexpected.map((name) => `unexpected in ZIP: ${name}`),
    ];
    fail(`The ZIP does not match the current Edge build:\n${details.map((item) => `- ${item}`).join('\n')}`);
  }
}

async function compareFileContents(packageBuffer, entries, packageFiles) {
  for (const name of packageFiles) {
    const packaged = extractZipEntry(packageBuffer, entries.get(name));
    const built = await readFile(path.join(BUILD_DIRECTORY, ...name.split('/')));
    if (!packaged.equals(built)) fail(`Packaged file does not match the current Edge build: ${name}`);
  }
}

async function validateSourceMetadata() {
  const packageJson = await readJson(path.join(ROOT, 'package.json'));
  const packageLock = await readJson(path.join(ROOT, 'package-lock.json'));
  const version = packageJson.version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Extension version must use x.y.z numeric format: ${version}`);
  if (packageLock.version !== version || packageLock.packages?.['']?.version !== version) {
    fail('package.json and package-lock.json versions do not match.');
  }

  const changelog = await readFile(path.join(ROOT, 'CHANGELOG.md'), 'utf8');
  if (!new RegExp(`^## ${version.replaceAll('.', '\\.')} - \\d{4}-\\d{2}-\\d{2}$`, 'm').test(changelog)) {
    fail(`CHANGELOG.md is missing a dated ${version} heading.`);
  }

  const releaseNotesPath = path.join(ROOT, 'docs', `release-notes-v${version}.md`);
  const releaseNotes = await readFile(releaseNotesPath, 'utf8').catch(() => fail(`Missing ${path.relative(ROOT, releaseNotesPath)}.`));
  if (!releaseNotes.startsWith(`# Pi Translator v${version}`)) fail(`Release notes title does not match v${version}.`);

  const certificationPath = path.join(ROOT, 'docs', `edge-certification-notes-v${version}.txt`);
  await stat(certificationPath).catch(() => fail(`Missing ${path.relative(ROOT, certificationPath)}.`));
  return { name: packageJson.name, version };
}

async function main() {
  const metadata = await validateSourceMetadata();
  const buildManifestPath = path.join(BUILD_DIRECTORY, 'manifest.json');
  const buildManifest = await readJson(buildManifestPath).catch(() => fail('Missing Edge build. Run npm run zip:edge first.'));
  if (buildManifest.manifest_version !== 3) fail('The Edge build is not Manifest V3.');
  if (buildManifest.version !== metadata.version) fail('The Edge build manifest version does not match package.json.');

  const packagePath = path.join(OUTPUT_DIRECTORY, `${metadata.name}-${metadata.version}-edge.zip`);
  const packageBuffer = await readFile(packagePath).catch(() => fail(`Missing ${path.relative(ROOT, packagePath)}.`));
  const entries = readZipEntries(packageBuffer);
  const packageFiles = [...entries.keys()].filter((name) => !name.endsWith('/')).sort();
  validatePackagePaths(packageFiles);
  for (const required of REQUIRED_PACKAGE_FILES) {
    if (!entries.has(required)) fail(`Required file is missing from the ZIP: ${required}`);
  }

  const packagedManifestEntry = entries.get('manifest.json');
  const packagedManifest = JSON.parse(extractZipEntry(packageBuffer, packagedManifestEntry).toString('utf8'));
  if (packagedManifest.version !== metadata.version || packagedManifest.manifest_version !== 3) {
    fail('The packaged manifest does not match the release metadata.');
  }

  const buildFiles = await listFiles(BUILD_DIRECTORY);
  compareFileLists(buildFiles, packageFiles);
  await compareFileContents(packageBuffer, entries, packageFiles);
  const digest = createHash('sha256').update(packageBuffer).digest('hex').toUpperCase();
  console.log(`Release consistency check passed for Pi Translator v${metadata.version}.`);
  console.log(`Package: ${path.relative(ROOT, packagePath)} (${packageBuffer.length} bytes)`);
  console.log(`SHA-256: ${digest}`);
  console.log(`Entries: ${packageFiles.length}; Manifest V${packagedManifest.manifest_version}.`);
}

main().catch((error) => {
  console.error(`Release consistency check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
