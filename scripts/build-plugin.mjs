#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pluginRoot = path.join(root, 'plugins', 'html-share-publisher');
const bundledServer = path.join(pluginRoot, 'mcp', 'server.mjs');
const bundledVerifier = path.join(pluginRoot, 'scripts', 'verify.cjs');
const skillSource = path.join(root, 'skills', 'html-share-publisher');
const skillTarget = path.join(pluginRoot, 'skills', 'html-share-publisher');
const esbuildPath = path.join(root, 'mcp', 'node_modules', 'esbuild', 'lib', 'main.js');
const manifestPath = path.join(pluginRoot, '.codex-plugin', 'plugin.json');

if (!fs.existsSync(esbuildPath)) {
  throw new Error('esbuild is missing. Run npm ci in mcp/ before building the plugin.');
}

const { build } = await import(pathToFileURL(esbuildPath).href);
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'mcp', 'package.json'), 'utf8')).version;
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.version = packageVersion;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

fs.rmSync(path.join(pluginRoot, 'mcp'), { recursive: true, force: true });
fs.rmSync(path.join(pluginRoot, 'scripts'), { recursive: true, force: true });
fs.mkdirSync(path.dirname(bundledServer), { recursive: true });
const bundleOptions = {
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  legalComments: 'none',
  sourcemap: false
};
await Promise.all([
  build({
    ...bundleOptions,
    entryPoints: [path.join(root, 'mcp', 'src', 'server.js')],
    outfile: bundledServer
  }),
  build({
    ...bundleOptions,
    entryPoints: [path.join(root, 'mcp', 'scripts', 'verify-plugin.mjs')],
    outfile: bundledVerifier,
    format: 'cjs'
  })
]);

fs.rmSync(skillTarget, { recursive: true, force: true });
fs.mkdirSync(path.dirname(skillTarget), { recursive: true });
fs.cpSync(skillSource, skillTarget, { recursive: true });

console.log(`Built Codex plugin MCP: ${bundledServer}`);
console.log(`Built Codex plugin verifier: ${bundledVerifier}`);
console.log(`Synced Codex plugin Skill: ${skillTarget}`);
console.log(`Synced Codex plugin version: ${packageVersion}`);
