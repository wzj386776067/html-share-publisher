import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';

const EXCLUDED_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);
const SENSITIVE_DIRECTORIES = new Set(['.ssh', '.aws', '.azure', '.gcloud']);
const SENSITIVE_EXACT_NAMES = new Set([
  '.env',
  '.npmrc',
  '.pypirc',
  '.netrc',
  'credentials.json',
  'credential.json',
  'secrets.json',
  'secret.json',
  'service-account.json',
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519'
]);
const SENSITIVE_EXTENSIONS = new Set(['.pem', '.key', '.p12', '.pfx']);
const SENSITIVE_NAME_PATTERNS = [
  /(^|[-_.])secret(s)?([-_.]|$)/,
  /(^|[-_.])token([-_.]|$)/,
  /(^|[-_.])credential(s)?([-_.]|$)/,
  /(^|[-_.])api[-_]?key([-_.]|$)/,
  /(^|[-_.])private[-_]?key([-_.]|$)/
];
const MAX_FILES = 500;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 150 * 1024 * 1024;
const BLOCKED_EXTENSIONS = new Set([
  '.php', '.jsp', '.asp', '.aspx', '.exe', '.sh', '.bat', '.cmd', '.com',
  '.mp4', '.mov', '.avi', '.mkv', '.webm'
]);

export function inspectSource(sourcePath) {
  const absolutePath = path.resolve(sourcePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw inputError('不支持把符号链接作为发布源。');

  if (stat.isFile() && path.extname(absolutePath).toLowerCase() === '.zip') {
    return {
      sourcePath: absolutePath,
      sourceRoot: path.dirname(absolutePath),
      defaultTitle: path.basename(absolutePath, path.extname(absolutePath)),
      manifestPath: sidecarManifestPath(absolutePath),
      kind: 'zip',
      files: [absolutePath],
      fingerprint: hashFiles([absolutePath], path.dirname(absolutePath)),
      warnings: []
    };
  }

  if (stat.isFile() && ['.html', '.htm'].includes(path.extname(absolutePath).toLowerCase())) {
    return {
      sourcePath: absolutePath,
      sourceRoot: path.dirname(absolutePath),
      defaultTitle: path.basename(absolutePath, path.extname(absolutePath)),
      manifestPath: sidecarManifestPath(absolutePath),
      kind: 'html',
      files: [absolutePath],
      fingerprint: hashFiles([absolutePath], path.dirname(absolutePath)),
      warnings: ['当前只会打包这个 HTML 文件；若页面引用本地图片、CSS 或 JS，请改为选择整个目录。']
    };
  }

  if (!stat.isDirectory()) throw inputError('发布源必须是目录、HTML 文件或 ZIP 文件。');
  const files = walkFiles(absolutePath);
  if (!files.length) throw inputError('发布目录为空。');
  return {
    sourcePath: absolutePath,
    sourceRoot: absolutePath,
    defaultTitle: path.basename(absolutePath),
    manifestPath: path.join(absolutePath, '.htmlshare.json'),
    kind: 'directory',
    files,
    fingerprint: hashFiles(files, absolutePath),
    warnings: []
  };
}

export function packageSource(source) {
  if (source.kind === 'zip') return { zipPath: source.sourcePath, cleanup: () => {} };
  validateSourceFiles(source);
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-'));
  const zipPath = path.join(tempDir, 'publish.zip');
  const files = Object.fromEntries(source.files.map((file) => [
    path.relative(source.sourceRoot, file).replaceAll(path.sep, '/'),
    new Uint8Array(fs.readFileSync(file))
  ]));
  fs.writeFileSync(zipPath, zipSync(files, { level: 6 }));
  return {
    zipPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
}

export function precheckSourcePackage(source, { entryFile = '' } = {}) {
  const packaged = packageSource(source);
  try {
    const entries = inspectZip(packaged.zipPath).filter((entry) => !entry.path.endsWith('/'));
    const errors = [];
    if (entries.length > MAX_FILES) errors.push(`文件数量超过限制：最多 ${MAX_FILES} 个。`);
    const totalBytes = entries.reduce((sum, entry) => sum + entry.size, 0);
    if (totalBytes > MAX_TOTAL_BYTES) errors.push('解压后总大小超过限制：最多 150MB。');

    for (const entry of entries) {
      const normalized = entry.path.replaceAll('\\', '/');
      const extension = path.extname(normalized).toLowerCase();
      if (isUnsafeArchivePath(normalized)) errors.push(`包含路径穿越或绝对路径：${entry.path}`);
      if (BLOCKED_EXTENSIONS.has(extension)) errors.push(`包含不支持的文件：${entry.path}`);
      if (isSensitivePath(normalized, false)) errors.push(`包含疑似敏感文件：${entry.path}`);
      if (entry.size > MAX_FILE_BYTES) errors.push(`单个文件超过限制：${entry.path}`);
    }
    if (errors.length) throw inputError(errors.join('\n'));

    const stripPrefix = findStripPrefix(entries.map((entry) => entry.path.replaceAll('\\', '/')));
    const paths = entries.map((entry) => normalizeWithPrefix(entry.path, stripPrefix));
    const htmlCandidates = paths.filter(isHtmlPath).sort((a, b) => a.localeCompare(b));
    const normalizedEntry = String(entryFile || '').replaceAll('\\', '/').replace(/^\/+/, '');
    const resolvedEntry = normalizedEntry
      ? (isHtmlPath(normalizedEntry) && paths.includes(normalizedEntry) ? normalizedEntry : '')
      : (paths.includes('index.html') ? 'index.html' : (htmlCandidates.length === 1 ? htmlCandidates[0] : ''));
    if (normalizedEntry && !resolvedEntry) throw inputError(`指定入口文件不存在或不是 HTML：${entryFile}`);
    if (!htmlCandidates.length) throw inputError('作品中没有可用的 HTML 入口文件。');

    return {
      entryFile: resolvedEntry || null,
      suggestedEntryFile: paths.includes('index.html') ? 'index.html' : (htmlCandidates.length === 1 ? htmlCandidates[0] : null),
      htmlCandidates,
      requiresEntrySelection: !normalizedEntry && htmlCandidates.length > 1,
      fileCount: entries.length,
      totalBytes
    };
  } finally {
    packaged.cleanup();
  }
}

export function readLocalManifest(source) {
  try {
    const manifest = JSON.parse(fs.readFileSync(source.manifestPath, 'utf8'));
    return manifest?.siteId ? manifest : null;
  } catch {
    return null;
  }
}

function walkFiles(root, current = root, files = []) {
  for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED_NAMES.has(entry.name) || entry.name === '.htmlshare.json' || entry.name.endsWith('.htmlshare.json')) continue;
    const entryPath = path.join(current, entry.name);
    const relativePath = path.relative(root, entryPath).replaceAll(path.sep, '/');
    if (entry.isSymbolicLink()) throw inputError(`发布目录中包含符号链接：${relativePath}`);
    if (isSensitivePath(relativePath, entry.isDirectory())) {
      throw inputError(`发布目录中包含疑似敏感文件：${relativePath}。请移出后再发布。`);
    }
    if (entry.isDirectory()) walkFiles(root, entryPath, files);
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
}

function isSensitivePath(relativePath, isDirectory) {
  const parts = relativePath.split('/');
  const basename = parts.at(-1).toLowerCase();
  if (isDirectory && SENSITIVE_DIRECTORIES.has(basename)) return true;
  if (parts.some((part) => SENSITIVE_DIRECTORIES.has(part.toLowerCase()))) return true;
  if (basename === '.env' || basename.startsWith('.env.')) return true;
  if (SENSITIVE_EXACT_NAMES.has(basename)) return true;
  if (SENSITIVE_EXTENSIONS.has(path.extname(basename))) return true;
  return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(basename));
}

function inspectZip(zipPath) {
  const entries = [];
  try {
    unzipSync(new Uint8Array(fs.readFileSync(zipPath)), {
      filter(file) {
        entries.push({ path: file.name, size: file.originalSize });
        return false;
      }
    });
  } catch {
    throw inputError('ZIP 文件损坏或使用了不支持的压缩格式。');
  }
  return entries;
}

function validateSourceFiles(source) {
  if (source.files.length > MAX_FILES) throw inputError(`文件数量超过限制：最多 ${MAX_FILES} 个。`);
  let totalBytes = 0;
  for (const file of source.files) {
    const relativePath = path.relative(source.sourceRoot, file).replaceAll(path.sep, '/');
    const size = fs.statSync(file).size;
    totalBytes += size;
    if (BLOCKED_EXTENSIONS.has(path.extname(relativePath).toLowerCase())) {
      throw inputError(`包含不支持的文件：${relativePath}`);
    }
    if (size > MAX_FILE_BYTES) throw inputError(`单个文件超过限制：${relativePath}`);
  }
  if (totalBytes > MAX_TOTAL_BYTES) throw inputError('解压后总大小超过限制：最多 150MB。');
}

function isUnsafeArchivePath(filePath) {
  return !filePath || filePath.startsWith('/') || /^[A-Za-z]:\//.test(filePath)
    || filePath.split('/').some((part) => part === '..');
}

function findStripPrefix(paths) {
  if (paths.includes('index.html')) return '';
  const roots = new Set(paths.map((filePath) => filePath.split('/')[0]).filter(Boolean));
  if (roots.size !== 1) return '';
  const [root] = roots;
  return paths.some((filePath) => filePath.startsWith(`${root}/`)) ? `${root}/` : '';
}

function normalizeWithPrefix(filePath, prefix) {
  const normalized = filePath.replaceAll('\\', '/');
  return prefix && normalized.startsWith(prefix) ? normalized.slice(prefix.length) : normalized;
}

function isHtmlPath(filePath) {
  return ['.html', '.htm'].includes(path.extname(filePath).toLowerCase());
}

function sidecarManifestPath(sourcePath) {
  const extension = path.extname(sourcePath);
  return path.join(path.dirname(sourcePath), `${path.basename(sourcePath, extension)}.htmlshare.json`);
}

function hashFiles(files, root) {
  const hash = createHash('sha256');
  for (const file of files) {
    hash.update(path.relative(root, file).replaceAll(path.sep, '/'));
    hash.update('\0');
    hash.update(hashFileChunked(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function hashFileChunked(filePath) {
  const hash = createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest();
}

function inputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_SOURCE';
  error.recovery = '检查 sourcePath，并确保选择完整的静态 HTML 作品目录。';
  return error;
}
