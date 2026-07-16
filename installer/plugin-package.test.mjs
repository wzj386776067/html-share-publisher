import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(root, 'plugins', 'html-share-publisher');

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(root, relativePath), 'utf8'));
}

test('Codex marketplace installs the combined MCP and Skill plugin', () => {
  const marketplace = readJson('.agents/plugins/marketplace.json');
  const entry = marketplace.plugins.find((plugin) => plugin.name === 'html-share-publisher');
  const manifest = readJson('plugins/html-share-publisher/.codex-plugin/plugin.json');
  const mcp = readJson('plugins/html-share-publisher/.mcp.json');
  const packageJson = readJson('mcp/package.json');

  assert.equal(marketplace.name, 'bicheng-html-share');
  assert.equal(entry.source.path, './plugins/html-share-publisher');
  assert.equal(manifest.skills, './skills/');
  assert.equal(manifest.mcpServers, './.mcp.json');
  assert.equal(manifest.version, packageJson.version);
  assert.equal(mcp.mcpServers['html-share'].command, 'node');
  assert.deepEqual(mcp.mcpServers['html-share'].args, ['./mcp/server.mjs']);
  assert.ok(fs.existsSync(path.join(pluginRoot, 'mcp', 'server.mjs')));
  assert.ok(fs.existsSync(path.join(pluginRoot, 'scripts', 'verify.cjs')));
});

test('Codex plugin Skill is synchronized with the universal installer Skill', () => {
  for (const relativePath of ['SKILL.md', 'agents/openai.yaml', 'references/mcp-tools.md']) {
    const source = fs.readFileSync(path.join(root, 'skills', 'html-share-publisher', relativePath), 'utf8');
    const bundled = fs.readFileSync(path.join(pluginRoot, 'skills', 'html-share-publisher', relativePath), 'utf8');
    assert.equal(bundled, source, `${relativePath} is out of sync; run npm run build:plugin --prefix mcp`);
  }
});
