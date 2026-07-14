import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const EXCLUDED_NAMES = new Set(['.git', 'node_modules', '.DS_Store']);

export function inspectSource(sourcePath) {
  const absolutePath = path.resolve(sourcePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw inputError('不支持把符号链接作为发布源。');

  if (stat.isFile() && path.extname(absolutePath).toLowerCase() === '.zip') {
    return {
      sourcePath: absolutePath,
      sourceRoot: path.dirname(absolutePath),
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

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (EXCLUDED_NAMES.has(entry.name) || entry.name === '.htmlshare.json' || entry.name.endsWith('.htmlshare.json')) continue;
    const entryPath = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw inputError(`发布目录中包含符号链接：${path.relative(root, entryPath)}`);
    if (entry.isDirectory()) files.push(...walkFiles(entryPath));
    else if (entry.isFile()) files.push(entryPath);
  }
  return files;
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
    hash.update(fs.readFileSync(file));
    hash.update('\0');
  }
  return hash.digest('hex');
}

function inputError(message) {
  const error = new Error(message);
  error.code = 'INVALID_SOURCE';
  error.recovery = '检查 sourcePath，并确保选择完整的静态 HTML 作品目录。';
  return error;
}
