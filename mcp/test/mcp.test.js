import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { zipSync } from 'fflate';

import { inspectSource, packageSource, precheckSourcePackage, prepareSourceUpload, readLocalManifest } from '../src/package-source.js';
import {
  confirmationSummary,
  generateExternalPassword,
  externalExpiryConfirmation,
  normalizePrecheckResult,
  normalizeSiteId,
  normalizeSiteReference,
  resolvePublishedLinks,
  resolvePublishTitle,
  siteStatusConfirmation,
  validateAccessPolicyConfirmation,
  validateEntryFileConfirmation
} from '../src/service.js';

test('exposes the complete safe publish tool set over MCP stdio', async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('src/server.js')]
  });
  const client = new Client({ name: 'html-share-mcp-test', version: '1.0.0' });
  await client.connect(transport);
  try {
    const result = await client.listTools();
    assert.match(client.getInstructions(), /只有用户对当前最新 confirmation 明确确认后，才能调用 execute_publish/);
    assert.match(client.getInstructions(), /必须询问用户使用建议名称还是自定义名称/);
    assert.match(client.getInstructions(), /必须让用户明确选择/);
    assert.match(client.getInstructions(), /默认 90 天且可在最终确认时修改/);
    assert.match(client.getInstructions(), /有效天数、准确到期时间和是否使用默认值/);
    assert.match(client.getInstructions(), /重新调用 prepare_publish 并展示新的 confirmation/);
    assert.match(client.getInstructions(), /只把 recipientUrl 作为给接收者的链接/);
    assert.match(client.getInstructions(), /external_link 时绝不能用内部 shareUrl/);
    assert.match(client.getInstructions(), /Markdown、TXT、Word、PowerPoint 和 Excel/);
    assert.deepEqual(result.tools.map((tool) => tool.name), [
      'auth_status',
      'start_login',
      'revoke_authorization',
      'precheck_package',
      'find_sites',
      'prepare_site_status_change',
      'execute_site_status_change',
      'resolve_contacts',
      'prepare_publish',
      'execute_publish'
    ]);
    const execute = result.tools.find((tool) => tool.name === 'execute_publish');
    assert.equal(execute.inputSchema.properties.confirmed.const, true);
    const prepare = result.tools.find((tool) => tool.name === 'prepare_publish');
    assert.ok(prepare.inputSchema.required.includes('titleDecision'));
    assert.ok(prepare.inputSchema.required.includes('accessPolicyConfirmed'));
    assert.equal(prepare.inputSchema.properties.accessPolicyConfirmed.const, true);
    const passwordSchema = prepare.inputSchema.properties.externalPassword;
    assert.equal(passwordSchema.minLength, 4);
    assert.equal(passwordSchema.maxLength, 4);
    assert.equal(passwordSchema.pattern, '^[A-Za-z0-9]{4}$');
    assert.equal(prepare.inputSchema.properties.entryFileConfirmed.const, true);
    assert.match(prepare.inputSchema.properties.externalExpiresAt.description, /“30 天”/);
    assert.match(prepare.inputSchema.properties.externalExpiresAt.description, /默认 90 天/);
    const prepareStatus = result.tools.find((tool) => tool.name === 'prepare_site_status_change');
    const executeStatus = result.tools.find((tool) => tool.name === 'execute_site_status_change');
    assert.deepEqual(prepareStatus.inputSchema.properties.action.enum, ['unpublish', 'republish']);
    assert.equal(executeStatus.inputSchema.properties.confirmed.const, true);
    assert.match(client.getInstructions(), /AI 只能下架或恢复当前用户自己发布的作品/);
    const precheck = result.tools.find((tool) => tool.name === 'precheck_package');
    assert.match(precheck.description, /文档/);
    assert.match(precheck.inputSchema.properties.sourcePath.description, /PowerPoint/);
  } finally {
    await client.close();
  }
});

test('describes reversible unpublish impact and inactive external access after restore', () => {
  const siteSnapshot = {
    siteId: 'site_owned',
    title: '摄影网站',
    status: 'published',
    accessPolicy: 'external_link',
    currentVersion: 3,
    entryFile: 'index.html'
  };
  const unpublish = siteStatusConfirmation({
    action: 'unpublish',
    expectedStatus: 'published',
    targetStatus: 'unpublished',
    siteSnapshot,
    externalAccess: { enabled: true, active: true, expiresAt: '2026-10-19T08:00:00.000Z' }
  });
  assert.equal(unpublish.action, '下架作品');
  assert.equal(unpublish.impact.recipientAccessStopsImmediately, true);
  assert.equal(unpublish.impact.filesRetained, true);
  assert.equal(unpublish.impact.stableLinkRetained, true);
  assert.equal(unpublish.impact.reversible, true);

  const restore = siteStatusConfirmation({
    action: 'republish',
    expectedStatus: 'unpublished',
    targetStatus: 'published',
    siteSnapshot: { ...siteSnapshot, status: 'unpublished' },
    externalAccess: { enabled: false, active: false, expiresAt: '' }
  });
  assert.equal(restore.action, '恢复上线');
  assert.equal(restore.impact.externalAccessWillResume, false);
  assert.match(restore.warning, /外部访问仍不可用/);
});

test('describes default and custom external expiry without adding another blocking decision', () => {
  const defaultExpiry = externalExpiryConfirmation({
    createdAt: '2026-07-21T08:00:00.000Z',
    externalExpiresAt: '2026-10-19T08:00:00.000Z',
    externalExpiryMode: 'default_90_days'
  });
  assert.deepEqual(defaultExpiry, {
    expiresAt: '2026-10-19T08:00:00.000Z',
    validityDays: 90,
    expiryMode: 'default_90_days',
    defaultApplied: true,
    canModifyBeforePublish: true,
    displayText: '默认 90 天，可在最终确认前修改'
  });

  const customExpiry = externalExpiryConfirmation({
    createdAt: '2026-07-21T08:00:00.000Z',
    externalExpiresAt: '2026-08-20T08:00:00.000Z',
    externalExpiryMode: 'custom'
  });
  assert.equal(customExpiry.validityDays, 30);
  assert.equal(customExpiry.defaultApplied, false);
  assert.equal(customExpiry.displayText, '用户指定 30 天');
});

test('normalizes old and new precheck contracts and requires confirmed multi-html entry selection', () => {
  const oldContract = normalizePrecheckResult({
    htmlFiles: ['about.html', 'index.html'],
    entryFile: 'index.html',
    defaultEntryFile: 'index.html'
  });
  assert.deepEqual(oldContract.htmlCandidates, ['about.html', 'index.html']);
  assert.equal(oldContract.suggestedEntryFile, 'index.html');
  assert.equal(oldContract.requiresEntrySelection, true);

  const newContract = normalizePrecheckResult({
    htmlCandidates: ['about.html', 'home.html'],
    entryFile: null,
    suggestedEntryFile: null,
    requiresEntrySelection: true
  });
  assert.deepEqual(newContract.htmlCandidates, ['about.html', 'home.html']);
  assert.equal(newContract.requiresEntrySelection, true);

  assert.throws(
    () => validateEntryFileConfirmation({ htmlCandidates: oldContract.htmlCandidates }),
    (error) => error.code === 'ENTRY_REQUIRED'
  );
  assert.throws(
    () => validateEntryFileConfirmation({
      htmlCandidates: oldContract.htmlCandidates,
      entryFile: 'index.html'
    }),
    (error) => error.code === 'ENTRY_CONFIRMATION_REQUIRED'
  );
  assert.throws(
    () => validateEntryFileConfirmation({
      htmlCandidates: oldContract.htmlCandidates,
      entryFile: 'missing.html',
      entryFileConfirmed: true
    }),
    (error) => error.code === 'ENTRY_INVALID'
  );
  assert.equal(validateEntryFileConfirmation({
    htmlCandidates: oldContract.htmlCandidates,
    entryFile: 'index.html',
    entryFileConfirmed: true
  }), 'index.html');
  assert.equal(validateEntryFileConfirmation({
    htmlCandidates: ['slides.html'],
    resolvedEntryFile: 'slides.html'
  }), 'slides.html');
});

test('requires explicit title and access-policy decisions before preparing a publish', () => {
  assert.throws(
    () => resolvePublishTitle({ operation: 'new', suggestedTitle: '摄影网站' }),
    (error) => error.code === 'TITLE_DECISION_REQUIRED'
  );
  assert.throws(
    () => resolvePublishTitle({ operation: 'new', titleDecision: 'custom', title: '', suggestedTitle: '摄影网站' }),
    (error) => error.code === 'CUSTOM_TITLE_REQUIRED'
  );
  assert.equal(
    resolvePublishTitle({ operation: 'new', titleDecision: 'use_suggested', suggestedTitle: '摄影网站' }),
    '摄影网站'
  );
  assert.equal(
    resolvePublishTitle({ operation: 'update', titleDecision: 'keep_existing', existingTitle: '线上摄影网站' }),
    '线上摄影网站'
  );
  assert.throws(
    () => validateAccessPolicyConfirmation(false),
    (error) => error.code === 'ACCESS_POLICY_CONFIRMATION_REQUIRED'
  );
});

test('returns one unambiguous recipient URL without unsafe external fallback', () => {
  assert.deepEqual(resolvePublishedLinks({
    accessPolicy: 'company_link',
    shareUrl: 'https://content.example/s/site/',
    externalUrl: 'https://content.example/share/token/'
  }), {
    recipientUrl: 'https://content.example/s/site/',
    recipientAccess: 'dingtalk',
    internalPreviewUrl: '',
    linkWarning: ''
  });
  assert.deepEqual(resolvePublishedLinks({
    accessPolicy: 'external_link',
    shareUrl: 'https://content.example/s/site/',
    externalUrl: 'https://content.example/share/token/'
  }), {
    recipientUrl: 'https://content.example/share/token/',
    recipientAccess: 'external_password',
    internalPreviewUrl: 'https://content.example/s/site/',
    linkWarning: ''
  });
  assert.deepEqual(resolvePublishedLinks({
    accessPolicy: 'external_link',
    shareUrl: 'https://content.example/s/site/',
    externalUrl: ''
  }), {
    recipientUrl: '',
    recipientAccess: 'external_password',
    internalPreviewUrl: 'https://content.example/s/site/',
    linkWarning: '外部密码链接尚未生成，不能使用内部预览链接代替。'
  });
});

test('generates four-character alphanumeric external passwords', () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateExternalPassword(), /^[A-Za-z0-9]{4}$/);
  }
});

test('packages a directory deterministically while excluding local binding and dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-package-'));
  fs.mkdirSync(path.join(root, 'assets'));
  fs.mkdirSync(path.join(root, 'node_modules'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>');
  fs.writeFileSync(path.join(root, 'assets', 'app.js'), 'console.log("ok")');
  fs.writeFileSync(path.join(root, '.htmlshare.json'), JSON.stringify({ siteId: 'site_bound' }));
  fs.writeFileSync(path.join(root, 'node_modules', 'ignored.js'), 'ignored');

  const source = inspectSource(root);
  const packaged = packageSource(source);
  try {
    const listing = execFileSync('unzip', ['-Z1', packaged.zipPath], { encoding: 'utf8' });
    assert.match(listing, /index\.html/);
    assert.match(listing, /assets\/app\.js/);
    assert.doesNotMatch(listing, /htmlshare/);
    assert.doesNotMatch(listing, /node_modules/);
    assert.equal(readLocalManifest(source).siteId, 'site_bound');
  } finally {
    packaged.cleanup();
  }
});

test('rejects sensitive local files before packaging a directory', () => {
  for (const filename of ['.env', 'credentials.json', 'private-key.pem', 'api-token.txt']) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-sensitive-'));
    fs.writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>');
    fs.writeFileSync(path.join(root, filename), 'secret');

    assert.throws(() => inspectSource(root), /疑似敏感文件/);
  }
});

test('prechecks ZIP packages locally and rejects embedded secrets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-zip-precheck-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>');
  fs.writeFileSync(path.join(root, '.env.production'), 'SECRET=value');
  const zipPath = path.join(root, 'site.zip');
  execFileSync('zip', ['-q', zipPath, 'index.html', '.env.production'], { cwd: root });

  assert.throws(() => precheckSourcePackage(inspectSource(zipPath)), /疑似敏感文件/);
});

test('prechecks multiple HTML entries without uploading them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-local-precheck-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Home</h1>');
  fs.writeFileSync(path.join(root, 'about.html'), '<h1>About</h1>');

  const result = precheckSourcePackage(inspectSource(root));
  assert.deepEqual(result.htmlCandidates, ['about.html', 'index.html']);
  assert.equal(result.suggestedEntryFile, 'index.html');
  assert.equal(result.requiresEntrySelection, true);
});

test('prechecks Markdown and text documents locally without requiring an HTML entry choice', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-text-documents-'));
  const markdownPath = path.join(root, '季度复盘.md');
  const textPath = path.join(root, '访谈记录.txt');
  fs.writeFileSync(markdownPath, '# 季度复盘\n\n<section>内部内容</section>\n');
  fs.writeFileSync(textPath, '第一行\n第二行\n');

  const markdownSource = inspectSource(markdownPath);
  const markdown = precheckSourcePackage(markdownSource);
  assert.equal(markdownSource.kind, 'document');
  assert.equal(markdownSource.sourceFormat, 'md');
  assert.equal(markdown.entryFile, 'index.html');
  assert.equal(markdown.requiresEntrySelection, false);
  assert.deepEqual(markdown.htmlCandidates, []);
  assert.equal(markdown.fileCount, 1);
  assert.ok(markdown.characterCount > 0);
  assert.match(markdown.warnings.join('\n'), /原始 HTML/);

  const text = precheckSourcePackage(inspectSource(textPath));
  assert.equal(text.sourceFormat, 'txt');
  assert.equal(text.formatLabel, '纯文本');
  assert.equal(text.displayMode, 'article');
  assert.equal(text.warnings.length, 0);
});

test('prechecks Office documents locally and reports format-specific conversion warnings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-office-documents-'));
  const docxPath = path.join(root, '方案.docx');
  const pptxPath = path.join(root, '路演.pptx');
  const xlsxPath = path.join(root, '经营数据.xlsx');
  writeArchive(docxPath, {
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>方案正文</w:t></w:r></w:p></w:body></w:document>'
  });
  writeArchive(pptxPath, {
    '[Content_Types].xml': '<Types/>',
    'ppt/presentation.xml': '<p:presentation xmlns:p="p"/>',
    'ppt/slides/slide1.xml': '<p:sld xmlns:p="p"/>',
    'ppt/slides/slide2.xml': '<p:sld xmlns:p="p"/>'
  });
  writeArchive(xlsxPath, {
    '[Content_Types].xml': '<Types/>',
    'xl/workbook.xml': '<workbook><sheets><sheet name="汇总" sheetId="1"/><sheet name="底稿" sheetId="2" state="hidden"/></sheets></workbook>'
  });

  const word = precheckSourcePackage(inspectSource(docxPath));
  assert.equal(word.sourceFormat, 'docx');
  assert.equal(word.formatLabel, 'Word');
  assert.match(word.warnings.join('\n'), /动态控件/);

  const powerpoint = precheckSourcePackage(inspectSource(pptxPath));
  assert.equal(powerpoint.slideCount, 2);
  assert.equal(powerpoint.displayMode, 'slides');
  assert.match(powerpoint.warnings.join('\n'), /动画/);

  const workbook = precheckSourcePackage(inspectSource(xlsxPath));
  assert.equal(workbook.visibleSheetCount, 1);
  assert.equal(workbook.hiddenSheetCount, 1);
  assert.match(workbook.warnings.join('\n'), /隐藏工作表/);
  assert.match(workbook.warnings.join('\n'), /图表/);
});

test('rejects unsupported legacy Office files and malformed document packages with actionable messages', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-invalid-documents-'));
  const legacyPath = path.join(root, '旧版文档.doc');
  const malformedPath = path.join(root, '损坏文档.docx');
  fs.writeFileSync(legacyPath, 'legacy');
  fs.writeFileSync(malformedPath, 'not a zip');

  assert.throws(() => inspectSource(legacyPath), /另存为 \.docx/);
  assert.throws(() => precheckSourcePackage(inspectSource(malformedPath)), /不是有效的 Word 文档/);
});

test('uses distinct manifest sidecars for standalone source documents', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-document-sidecars-'));
  const sourcePath = path.join(root, '年度总结.pptx');
  writeArchive(sourcePath, {
    '[Content_Types].xml': '<Types/>',
    'ppt/presentation.xml': '<p:presentation xmlns:p="p"/>',
    'ppt/slides/slide1.xml': '<p:sld xmlns:p="p"/>'
  });

  const source = inspectSource(sourcePath);
  assert.equal(source.defaultTitle, '年度总结');
  assert.equal(source.manifestPath, path.join(root, '年度总结.htmlshare.json'));
});

test('uploads original documents while keeping HTML sources on the ZIP path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-upload-source-'));
  const markdownPath = path.join(root, '公告.md');
  fs.writeFileSync(markdownPath, '# 公告');

  const documentUpload = prepareSourceUpload(inspectSource(markdownPath));
  assert.equal(documentUpload.filePath, markdownPath);
  assert.equal(documentUpload.filename, '公告.md');
  assert.equal(documentUpload.contentType, 'application/octet-stream');
  documentUpload.cleanup();

  fs.writeFileSync(path.join(root, 'index.html'), '<h1>公告</h1>');
  const htmlUpload = prepareSourceUpload(inspectSource(path.join(root, 'index.html')));
  try {
    assert.equal(htmlUpload.filename, 'upload.zip');
    assert.equal(htmlUpload.contentType, 'application/zip');
    assert.ok(fs.existsSync(htmlUpload.filePath));
  } finally {
    htmlUpload.cleanup();
  }
});

test('shows document conversion details in the final confirmation without asking for an entry file', () => {
  const confirmation = confirmationSummary({
    title: '季度路演',
    titleDecision: 'use_suggested',
    operation: 'update',
    entryFile: 'index.html',
    entryFileConfirmed: false,
    sourceKind: 'document',
    sourceFormat: 'pptx',
    sourceFilename: '季度路演.pptx',
    formatLabel: 'PowerPoint',
    displayMode: 'slides',
    conversionWarnings: ['动画、切换效果、音频和视频不会保留。'],
    documentDetails: { slideCount: 18 },
    precheck: { fileCount: 1, totalBytes: 2048 },
    accessPolicy: 'company_link',
    accessPolicyConfirmed: true,
    permissions: []
  }, {
    id: 'site_123',
    title: '季度路演',
    currentVersion: { versionNumber: 2 }
  });

  assert.equal(confirmation.entryFile, null);
  assert.deepEqual(confirmation.source, {
    kind: 'document',
    filename: '季度路演.pptx',
    format: 'pptx',
    formatLabel: 'PowerPoint',
    displayMode: 'slides',
    size: 2048,
    details: { slideCount: 18 },
    conversionWarnings: ['动画、切换效果、音频和视频不会保留。']
  });
  assert.equal(confirmation.stableLinkWillRemain, true);
});

test('publishes an original document only after the confirmed MCP execution step', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-document-flow-'));
  const stateDir = path.join(root, 'state');
  const sourcePath = path.join(root, '公告.md');
  fs.mkdirSync(stateDir);
  fs.writeFileSync(sourcePath, '# 公告\n\n今天发布。');
  fs.writeFileSync(path.join(stateDir, 'credentials.json'), JSON.stringify({
    accessToken: 'delegated-test-token',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: 'user_1', name: '测试用户' }
  }));

  const requests = [];
  const api = http.createServer(async (req, res) => {
    const body = await readRequestBody(req);
    requests.push({ method: req.method, url: req.url, headers: req.headers, body });
    if (req.method === 'GET' && req.url === '/api/mcp/auth/status') {
      return sendJson(res, 200, {
        status: 'authorized',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        scopes: ['sites:write'],
        user: { id: 'user_1', name: '测试用户' }
      });
    }
    if (req.method === 'POST' && req.url === '/api/mcp/publish-plans') {
      return sendJson(res, 201, {
        planId: 'server_plan_1',
        planToken: 'signed-plan-token',
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      });
    }
    if (req.method === 'POST' && req.url === '/api/sites') {
      assert.equal(decodeURIComponent(req.headers['x-upload-filename']), '公告.md');
      assert.equal(req.headers['content-type'], 'application/octet-stream');
      assert.equal(body.toString('utf8'), '# 公告\n\n今天发布。');
      return sendJson(res, 201, {
        id: 'site_doc',
        title: '公告',
        accessPolicy: 'company_link',
        currentVersion: {
          id: 'ver_doc_1',
          versionNumber: 1,
          entryFile: 'index.html',
          contentHash: 'document-hash',
          sourceFormat: 'md',
          sourceFilename: '公告.md'
        }
      });
    }
    if (req.method === 'GET' && req.url === '/api/sites/resolve?reference=site_doc') {
      return sendJson(res, 200, {
        id: 'site_doc',
        ownerId: 'user_1',
        title: '公告',
        description: '',
        alias: '',
        accessPolicy: 'company_link',
        permissions: [],
        currentVersion: { id: 'ver_doc_1', versionNumber: 1, entryFile: 'index.html' }
      });
    }
    if (req.method === 'GET' && req.url === '/api/sites/site_doc') {
      return sendJson(res, 200, {
        id: 'site_doc',
        ownerId: 'user_1',
        title: '公告',
        description: '',
        alias: '',
        accessPolicy: 'company_link',
        permissions: [],
        currentVersion: { id: 'ver_doc_1', versionNumber: 1, entryFile: 'index.html' }
      });
    }
    if (req.method === 'POST' && req.url === '/api/sites/site_doc/publish-version') {
      assert.equal(decodeURIComponent(req.headers['x-upload-filename']), '公告.md');
      assert.equal(body.toString('utf8'), '# 公告\n\n更新后的内容。');
      return sendJson(res, 200, {
        id: 'site_doc',
        title: '公告',
        accessPolicy: 'company_link',
        currentVersion: {
          id: 'ver_doc_2',
          versionNumber: 2,
          entryFile: 'index.html',
          contentHash: 'updated-document-hash',
          sourceFormat: 'md',
          sourceFilename: '公告.md'
        }
      });
    }
    if (req.method === 'GET' && req.url === '/api/sites/site_doc/manifest') {
      return sendJson(res, 200, { shareUrl: 'https://share-content.example/s/announcement~AbCdEf123456/' });
    }
    sendJson(res, 404, { error: 'not found' });
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  const address = api.address();
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve('src/server.js')],
    env: {
      ...process.env,
      HTML_SHARE_API_BASE: `http://127.0.0.1:${address.port}`,
      HTML_SHARE_CONFIG_DIR: stateDir,
      HTML_SHARE_CLIENT_NAME: 'MCP document test'
    }
  });
  const client = new Client({ name: 'html-share-document-flow-test', version: '1.0.0' });
  try {
    await client.connect(transport);
    const precheck = await client.callTool({ name: 'precheck_package', arguments: { sourcePath } });
    assert.equal(precheck.structuredContent.sourceFormat, 'md');
    assert.equal(requests.filter((request) => request.method === 'POST').length, 0);

    const prepareArguments = {
      sourcePath,
      operation: 'new',
      titleDecision: 'use_suggested',
      accessPolicy: 'company_link',
      accessPolicyConfirmed: true
    };
    let prepared = await client.callTool({
      name: 'prepare_publish',
      arguments: prepareArguments
    });
    assert.equal(prepared.structuredContent.confirmation.entryFile, null);
    assert.equal(requests.filter((request) => request.url === '/api/sites').length, 0);

    fs.writeFileSync(sourcePath, '# 已被修改');
    const blocked = await client.callTool({
      name: 'execute_publish',
      arguments: { planId: prepared.structuredContent.planId, confirmed: true }
    });
    assert.equal(blocked.isError, true);
    assert.equal(blocked.structuredContent.code, 'SOURCE_CHANGED');
    assert.equal(requests.filter((request) => request.url === '/api/sites').length, 0);

    fs.writeFileSync(sourcePath, '# 公告\n\n今天发布。');
    prepared = await client.callTool({ name: 'prepare_publish', arguments: prepareArguments });

    const published = await client.callTool({
      name: 'execute_publish',
      arguments: { planId: prepared.structuredContent.planId, confirmed: true }
    });
    assert.equal(published.structuredContent.sourceFormat, 'md');
    assert.equal(published.structuredContent.recipientUrl, 'https://share-content.example/s/announcement~AbCdEf123456/');
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '公告.htmlshare.json'))).siteId, 'site_doc');
    assert.equal(requests.filter((request) => request.url === '/api/sites').length, 1);

    fs.writeFileSync(sourcePath, '# 公告\n\n更新后的内容。');
    const updatePrecheck = await client.callTool({ name: 'precheck_package', arguments: { sourcePath } });
    assert.equal(updatePrecheck.structuredContent.suggestedOperation, 'update');
    const updatePrepared = await client.callTool({
      name: 'prepare_publish',
      arguments: {
        sourcePath,
        operation: 'update',
        titleDecision: 'keep_existing',
        accessPolicy: 'company_link',
        accessPolicyConfirmed: true
      }
    });
    assert.equal(updatePrepared.structuredContent.confirmation.stableLinkWillRemain, true);
    const updated = await client.callTool({
      name: 'execute_publish',
      arguments: { planId: updatePrepared.structuredContent.planId, confirmed: true }
    });
    assert.equal(updated.structuredContent.versionNumber, 2);
    assert.equal(updated.structuredContent.recipientUrl, published.structuredContent.recipientUrl);
    assert.equal(requests.filter((request) => request.url === '/api/sites/site_doc/publish-version').length, 1);
  } finally {
    await client.close();
    await new Promise((resolve) => api.close(resolve));
  }
});

test('rejects symlinks inside a publish directory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-symlink-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<h1>Hello</h1>');
  fs.symlinkSync(path.join(root, 'index.html'), path.join(root, 'linked.html'));
  assert.throws(() => inspectSource(root), /符号链接/);
});

test('uses distinct manifest sidecars for multiple standalone files in one folder', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-sidecars-'));
  const first = path.join(root, 'dashboard.html');
  const second = path.join(root, 'review.html');
  fs.writeFileSync(first, '<h1>Dashboard</h1>');
  fs.writeFileSync(second, '<h1>Review</h1>');

  assert.equal(inspectSource(first).manifestPath, path.join(root, 'dashboard.htmlshare.json'));
  assert.equal(inspectSource(second).manifestPath, path.join(root, 'review.htmlshare.json'));
  assert.equal(inspectSource(first).defaultTitle, 'dashboard');
});

test('derives default titles from source names and accepts readable share URLs as update targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-mcp-title-'));
  const directory = path.join(root, '季度经营复盘');
  fs.mkdirSync(directory);
  fs.writeFileSync(path.join(directory, 'index.html'), '<h1>Review</h1>');
  const zipPath = path.join(root, '经营看板.zip');
  fs.writeFileSync(zipPath, 'placeholder');

  assert.equal(inspectSource(directory).defaultTitle, '季度经营复盘');
  assert.equal(inspectSource(zipPath).defaultTitle, '经营看板');
  assert.equal(
    normalizeSiteId('https://share-content.example/s/%E5%AD%A3%E5%BA%A6%E7%BB%8F%E8%90%A5%E5%A4%8D%E7%9B%98~site_1234-abcd/'),
    'site_1234-abcd'
  );
  assert.deepEqual(
    normalizeSiteReference('https://share-content.example/s/%E5%AD%A3%E5%BA%A6%E7%BB%8F%E8%90%A5%E5%A4%8D%E7%9B%98~AbCdEf123_-9/'),
    { siteId: '', publicCode: 'AbCdEf123_-9' }
  );
  assert.deepEqual(normalizeSiteReference('AbCdEf123_-9'), { siteId: '', publicCode: 'AbCdEf123_-9' });
  assert.deepEqual(normalizeSiteReference('site_1234-abcd'), { siteId: 'site_1234-abcd', publicCode: '' });
});

function writeArchive(filePath, entries) {
  fs.writeFileSync(filePath, zipSync(Object.fromEntries(
    Object.entries(entries).map(([name, content]) => [name, new TextEncoder().encode(content)])
  )));
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
