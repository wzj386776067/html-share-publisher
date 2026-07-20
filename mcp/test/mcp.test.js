import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

import { inspectSource, packageSource, readLocalManifest } from '../src/package-source.js';
import {
  generateExternalPassword,
  normalizeSiteId,
  resolvePublishTitle,
  validateAccessPolicyConfirmation
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
    assert.match(client.getInstructions(), /只有用户在后续明确确认后，才能调用 execute_publish/);
    assert.match(client.getInstructions(), /必须询问用户使用建议名称还是自定义名称/);
    assert.match(client.getInstructions(), /必须让用户明确选择/);
    assert.deepEqual(result.tools.map((tool) => tool.name), [
      'auth_status',
      'start_login',
      'revoke_authorization',
      'precheck_package',
      'find_sites',
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
  } finally {
    await client.close();
  }
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
});
