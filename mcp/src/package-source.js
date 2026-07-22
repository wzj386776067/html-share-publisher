import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { unzipSync, zipSync } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

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
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
const MAX_TEXT_BYTES = 10 * 1024 * 1024;
const MAX_OFFICE_ENTRIES = 10_000;
const MAX_OFFICE_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;
const MAX_OFFICE_XML_BYTES = 20 * 1024 * 1024;
const DOCUMENT_FORMATS = new Map([
  ['.md', { format: 'md', label: 'Markdown', displayMode: 'article' }],
  ['.txt', { format: 'txt', label: '纯文本', displayMode: 'article' }],
  ['.docx', { format: 'docx', label: 'Word', displayMode: 'document' }],
  ['.pptx', { format: 'pptx', label: 'PowerPoint', displayMode: 'slides' }],
  ['.xlsx', { format: 'xlsx', label: 'Excel', displayMode: 'workbook' }]
]);
const LEGACY_OFFICE_FORMATS = new Map([
  ['.doc', '.docx'],
  ['.ppt', '.pptx'],
  ['.xls', '.xlsx']
]);
const XML_PARSER = new XMLParser({ ignoreAttributes: false, processEntities: false });
const BLOCKED_EXTENSIONS = new Set([
  '.php', '.jsp', '.asp', '.aspx', '.exe', '.sh', '.bat', '.cmd', '.com',
  '.mp4', '.mov', '.avi', '.mkv', '.webm'
]);

export function inspectSource(sourcePath) {
  const absolutePath = path.resolve(sourcePath);
  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) throw inputError('不支持把符号链接作为发布源。');
  const extension = path.extname(absolutePath).toLowerCase();

  if (stat.isFile() && LEGACY_OFFICE_FORMATS.has(extension)) {
    throw inputError(`暂不支持旧版 ${extension} 文件，请另存为 ${LEGACY_OFFICE_FORMATS.get(extension)} 后重试。`);
  }

  if (stat.isFile() && DOCUMENT_FORMATS.has(extension)) {
    if (stat.size > MAX_UPLOAD_BYTES) throw inputError('文档文件不能超过 100MB。');
    const documentFormat = DOCUMENT_FORMATS.get(extension);
    return {
      sourcePath: absolutePath,
      sourceRoot: path.dirname(absolutePath),
      defaultTitle: path.basename(absolutePath, extension),
      manifestPath: sidecarManifestPath(absolutePath),
      kind: 'document',
      sourceFormat: documentFormat.format,
      formatLabel: documentFormat.label,
      displayMode: documentFormat.displayMode,
      files: [absolutePath],
      fingerprint: hashFiles([absolutePath], path.dirname(absolutePath)),
      warnings: []
    };
  }

  if (stat.isFile() && extension === '.zip') {
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

  if (stat.isFile() && ['.html', '.htm'].includes(extension)) {
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

  if (!stat.isDirectory()) {
    throw inputError('发布源必须是静态网站目录、HTML、ZIP、Markdown、TXT、Word、PowerPoint 或 Excel 文件。');
  }
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
  if (source.kind === 'document') throw inputError('文档应上传原始文件，不能在本地打包为 HTML ZIP。');
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

export function prepareSourceUpload(source) {
  if (source.kind === 'document') {
    return {
      filePath: source.sourcePath,
      filename: path.basename(source.sourcePath),
      contentType: 'application/octet-stream',
      cleanup() {}
    };
  }
  const packaged = packageSource(source);
  return {
    filePath: packaged.zipPath,
    filename: 'upload.zip',
    contentType: 'application/zip',
    cleanup: packaged.cleanup
  };
}

export function precheckSourcePackage(source, { entryFile = '' } = {}) {
  if (source.kind === 'document') return precheckDocument(source);
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

function precheckDocument(source) {
  const stat = fs.statSync(source.sourcePath);
  const common = {
    sourceFormat: source.sourceFormat,
    formatLabel: source.formatLabel,
    sourceFilename: path.basename(source.sourcePath),
    displayMode: source.displayMode,
    entryFile: 'index.html',
    suggestedEntryFile: 'index.html',
    htmlCandidates: [],
    requiresEntrySelection: false,
    fileCount: 1,
    totalBytes: stat.size,
    sourceBytes: stat.size
  };
  if (source.sourceFormat === 'md' || source.sourceFormat === 'txt') {
    return { ...common, ...inspectTextDocument(source) };
  }
  return { ...common, ...inspectOfficeDocument(source) };
}

function inspectTextDocument(source) {
  const buffer = fs.readFileSync(source.sourcePath);
  if (buffer.length > MAX_TEXT_BYTES) throw inputError('文本文件不能超过 10MB。');
  if (buffer.includes(0)) throw inputError('文件包含二进制内容，无法作为文本发布。');
  const { text, encoding } = decodeText(buffer);
  if (!text.trim()) throw inputError('文件内容为空。');
  return {
    encoding,
    characterCount: text.length,
    warnings: source.sourceFormat === 'md' && /<\/?[a-z][\s\S]*?>/i.test(text)
      ? ['Markdown 中的原始 HTML 将被安全过滤。']
      : []
  };
}

function inspectOfficeDocument(source) {
  const { entries, files } = readOfficeArchive(source);
  const requiredEntry = source.sourceFormat === 'docx' ? 'word/document.xml'
    : source.sourceFormat === 'pptx' ? 'ppt/presentation.xml'
      : 'xl/workbook.xml';
  if (!entries.includes('[Content_Types].xml') || !entries.includes(requiredEntry)) {
    throw inputError(`文件内容不是有效的 ${source.formatLabel} 文档。`);
  }

  if (source.sourceFormat === 'docx') {
    const document = parseOfficeXml(files[requiredEntry], source.formatLabel);
    return {
      characterCount: countTextCharacters(document),
      warnings: ['宏、动态控件和外部数据不会执行。']
    };
  }
  if (source.sourceFormat === 'pptx') {
    const slideCount = entries.filter((entry) => /^ppt\/slides\/slide\d+\.xml$/i.test(entry)).length;
    if (!slideCount) throw inputError('PowerPoint 中没有可发布的幻灯片。');
    return {
      slideCount,
      warnings: ['动画、切换效果、音频和视频不会保留。']
    };
  }

  const workbook = parseOfficeXml(files[requiredEntry], source.formatLabel);
  const sheetsValue = workbook?.workbook?.sheets?.sheet;
  const sheets = Array.isArray(sheetsValue) ? sheetsValue : sheetsValue ? [sheetsValue] : [];
  if (!sheets.length) throw inputError('Excel 中没有可读取的工作表。');
  const hiddenSheets = sheets.filter((sheet) => String(sheet?.['@_state'] || 'visible') !== 'visible');
  const visibleSheets = sheets.filter((sheet) => String(sheet?.['@_state'] || 'visible') === 'visible');
  if (!visibleSheets.length) throw inputError('Excel 中没有可发布的可见工作表。');
  const warnings = ['图表、图片、批注、数据透视表等高级对象不会发布。'];
  if (hiddenSheets.length) {
    const names = hiddenSheets.slice(0, 10).map((sheet) => sheet?.['@_name']).filter(Boolean).join('、');
    warnings.push(`已排除隐藏工作表${names ? `：${names}` : ''}${hiddenSheets.length > 10 ? `（共 ${hiddenSheets.length} 个）` : ''}`);
  }
  return {
    visibleSheetCount: visibleSheets.length,
    hiddenSheetCount: hiddenSheets.length,
    warnings
  };
}

function readOfficeArchive(source) {
  const entries = [];
  let totalBytes = 0;
  try {
    const files = unzipSync(new Uint8Array(fs.readFileSync(source.sourcePath)), {
      filter(file) {
        const normalized = file.name.replaceAll('\\', '/');
        entries.push(normalized);
        totalBytes += Number(file.originalSize || 0);
        if (entries.length > MAX_OFFICE_ENTRIES || totalBytes > MAX_OFFICE_UNCOMPRESSED_BYTES) {
          throw inputError('Office 文件解压后体积或文件数量超过安全限制。');
        }
        if (isUnsafeArchivePath(normalized)) throw inputError('Office 文件包含不安全的内部路径。');
        const selected = normalized === 'word/document.xml' || normalized === 'ppt/presentation.xml'
          || normalized === 'xl/workbook.xml';
        if (selected && Number(file.originalSize || 0) > MAX_OFFICE_XML_BYTES) {
          throw inputError('Office 文件内部结构过大，无法安全预检。');
        }
        return selected;
      }
    });
    return { entries, files };
  } catch (error) {
    if (error?.code === 'INVALID_SOURCE') throw error;
    throw inputError(`文件内容不是有效的 ${source.formatLabel} 文档。`);
  }
}

function parseOfficeXml(bytes, formatLabel) {
  try {
    return XML_PARSER.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw inputError(`${formatLabel} 文件内部结构损坏，无法安全预检。`);
  }
}

function countTextCharacters(value, key = '') {
  if (typeof value === 'string') return /(^|:)t$/.test(key) ? value.length : 0;
  if (Array.isArray(value)) return value.reduce((sum, item) => sum + countTextCharacters(item, key), 0);
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [childKey, child]) => sum + countTextCharacters(child, childKey), 0);
}

function decodeText(buffer) {
  for (const encoding of ['utf-8', 'gb18030']) {
    try {
      return { text: new TextDecoder(encoding, { fatal: true }).decode(buffer), encoding };
    } catch {
      // Try the next company document encoding.
    }
  }
  throw inputError('文本编码无法识别，请转换为 UTF-8 或 GB18030 后重试。');
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
  error.recovery = '检查 sourcePath、文件格式和内容后重试。';
  return error;
}
