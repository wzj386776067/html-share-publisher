import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { configureClients, writeMcpConfig } from './configure-clients.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-client-config-'));
  const home = path.join(root, 'home');
  const skillSource = path.join(root, 'skill');
  const serverPath = path.join(root, 'install', 'mcp', 'src', 'server.js');
  fs.mkdirSync(skillSource, { recursive: true });
  fs.mkdirSync(path.dirname(serverPath), { recursive: true });
  fs.writeFileSync(path.join(skillSource, 'SKILL.md'), '---\nname: html-share-publisher\ndescription: test\n---\n');
  fs.writeFileSync(serverPath, '');
  return { root, home, skillSource, serverPath };
}

function options(source, extra = {}) {
  return {
    client: 'generic',
    home: source.home,
    installRoot: path.join(source.root, 'install'),
    skillSource: source.skillSource,
    serverPath: source.serverPath,
    nodePath: process.execPath,
    apiBase: 'https://share.bi-cheng.cn',
    skipCommandRegistration: true,
    env: { PATH: '' },
    ...extra
  };
}

test('merges WorkBuddy MCP config and installs the current Skill without removing existing servers', () => {
  const source = fixture();
  const configPath = path.join(source.home, '.workbuddy', 'mcp.json');
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: { existing: { command: 'existing' } }, setting: true }));

  const result = configureClients(options(source, { client: 'workbuddy' }));
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.setting, true);
  assert.equal(config.mcpServers.existing.command, 'existing');
  assert.equal(config.mcpServers['html-share'].env.HTML_SHARE_API_BASE, 'https://share.bi-cheng.cn');
  assert.equal(config.mcpServers['html-share'].env.HTML_SHARE_CLIENT_NAME, 'WorkBuddy');
  assert.deepEqual(result.selectedClients, ['workbuddy']);
  const skillPath = path.join(source.home, '.workbuddy', 'skills', 'html-share-publisher', 'SKILL.md');
  assert.ok(fs.existsSync(skillPath));
  assert.equal(result.skills.find((skill) => skill.client === 'workbuddy')?.path, path.dirname(skillPath));
});

test('configures TRAE global MCP and Skill locations on macOS', () => {
  const source = fixture();
  fs.mkdirSync(path.join(source.home, '.trae'), { recursive: true });
  fs.mkdirSync(path.join(source.home, '.trae-cn'), { recursive: true });

  configureClients(options(source, { client: 'trae', platform: 'darwin' }));
  assert.ok(fs.existsSync(path.join(source.home, '.trae', 'skills', 'html-share-publisher', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(source.home, '.trae-cn', 'skills', 'html-share-publisher', 'SKILL.md')));
  const traeConfigPath = path.join(source.home, 'Library', 'Application Support', 'Trae', 'User', 'settings', 'mcp.json');
  assert.ok(fs.existsSync(traeConfigPath));
  assert.ok(fs.existsSync(path.join(source.home, 'Library', 'Application Support', 'TRAE SOLO CN', 'User', 'mcp.json')));
  const config = JSON.parse(fs.readFileSync(traeConfigPath, 'utf8'));
  assert.equal(config.mcpServers['html-share'].env.HTML_SHARE_CLIENT_NAME, 'TRAE');
});

test('writes a generic importable MCP config for unsupported clients', () => {
  const source = fixture();
  configureClients(options(source));
  const configPath = path.join(source.root, 'install', 'mcp-config.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(config.mcpServers['html-share'].command, process.execPath);
  assert.deepEqual(config.mcpServers['html-share'].args, [source.serverPath]);
  assert.equal(config.mcpServers['html-share'].env.HTML_SHARE_CLIENT_NAME, 'Generic MCP client');
});

test('refuses to overwrite invalid JSON client config', () => {
  const source = fixture();
  const configPath = path.join(source.root, 'broken.json');
  fs.writeFileSync(configPath, '{broken');
  assert.throws(() => writeMcpConfig(configPath, {}), /invalid JSON/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), '{broken');
});

test('runs as a CLI when launched through a version symlink', () => {
  const source = fixture();
  const scriptPath = fileURLToPath(new URL('./configure-clients.mjs', import.meta.url));
  const linkedPath = path.join(source.root, 'current', 'configure-clients.mjs');
  fs.mkdirSync(path.dirname(linkedPath), { recursive: true });
  fs.symlinkSync(scriptPath, linkedPath);
  const result = spawnSync(process.execPath, [
    linkedPath,
    '--client', 'generic',
    '--home', source.home,
    '--install-root', path.join(source.root, 'install'),
    '--skill-source', source.skillSource,
    '--server-path', source.serverPath,
    '--node-path', process.execPath,
    '--api-base', 'https://share.bi-cheng.cn',
    '--skip-command-registration'
  ], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /"selectedClients"/);
  assert.ok(fs.existsSync(path.join(source.root, 'install', 'mcp-config.json')));
});
