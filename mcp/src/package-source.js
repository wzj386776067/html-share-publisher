import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-'));
  const zipPath = path.join(tempDir, 'publish.zip');
  const files = source.files.map((file) => path.relative(source.sourceRoot, file));
  execFileSync('zip', ['-q', zipPath, ...files], { cwd: source.sourceRoot });
  return {
    zipPath,
    cleanup: () => fs.rmSync(tempDir, { recursive: true, force: true })
  };
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
