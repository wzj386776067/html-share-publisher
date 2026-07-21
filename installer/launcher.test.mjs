import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { isNewerVersion, maybeAutoUpdate, resolveInstalledServer, verifyReleaseSignature } from '../launcher.mjs';

test('compares release versions without downgrading', () => {
  assert.equal(isNewerVersion('v0.3.1', 'v0.3.0'), true);
  assert.equal(isNewerVersion('v0.3.0', 'v0.3.0'), false);
  assert.equal(isNewerVersion('v0.2.9', 'v0.3.0'), false);
  assert.equal(isNewerVersion('latest', 'v0.3.0'), false);
});

test('rejects release signatures from any key except the pinned release key', () => {
  const { privateKey } = generateKeyPairSync('ed25519');
  const archive = Buffer.from('untrusted release');
  assert.equal(verifyReleaseSignature(archive, sign(null, archive, privateKey)), false);
  assert.equal(verifyReleaseSignature(archive, Buffer.from('invalid')), false);
});

test('keeps the installed MCP available when update checks fail', async () => {
  const root = createInstall('v0.3.0');
  const result = await maybeAutoUpdate({
    installRoot: root,
    force: true,
    logger: () => {},
    getLatestRelease: async () => { throw new Error('offline'); }
  });

  assert.equal(result.status, 'unavailable');
  assert.match(resolveInstalledServer(root), /v0\.3\.0/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'update-state.json'))).lastError, 'offline');
});

test('switches to a newer release only after the update succeeds', async () => {
  const root = createInstall('v0.3.0');
  const result = await maybeAutoUpdate({
    installRoot: root,
    force: true,
    logger: () => {},
    getLatestRelease: async () => ({ tagName: 'v0.3.1' }),
    applyRelease: async ({ release, installRoot }) => {
      const nextServer = path.join(installRoot, 'releases', release.tagName, 'mcp', 'src', 'server.js');
      fs.mkdirSync(path.dirname(nextServer), { recursive: true });
      fs.writeFileSync(nextServer, '// next');
      fs.writeFileSync(path.join(installRoot, 'VERSION'), `${release.tagName}\n`);
    },
    refreshClients: () => {}
  });

  assert.equal(result.status, 'updated');
  assert.match(resolveInstalledServer(root), /v0\.3\.1/);
});

test('keeps a successful MCP update when Skill refresh needs a retry', async () => {
  const root = createInstall('v0.3.0');
  const result = await maybeAutoUpdate({
    installRoot: root,
    force: true,
    logger: () => {},
    getLatestRelease: async () => ({ tagName: 'v0.3.1' }),
    applyRelease: async ({ release, installRoot }) => {
      const nextServer = path.join(installRoot, 'releases', release.tagName, 'mcp', 'src', 'server.js');
      fs.mkdirSync(path.dirname(nextServer), { recursive: true });
      fs.writeFileSync(nextServer, '// next');
      fs.writeFileSync(path.join(installRoot, 'VERSION'), `${release.tagName}\n`);
    },
    refreshClients: () => { throw new Error('client busy'); }
  });

  assert.equal(result.status, 'updated');
  assert.match(resolveInstalledServer(root), /v0\.3\.1/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'update-state.json'))).skillRefreshPending, true);
});

test('retries a pending Skill refresh without waiting for the next release check', async () => {
  const root = createInstall('v0.3.0');
  fs.writeFileSync(path.join(root, 'update-state.json'), JSON.stringify({
    lastAttemptAt: new Date().toISOString(),
    skillRefreshPending: true
  }));
  let refreshCount = 0;
  const result = await maybeAutoUpdate({
    installRoot: root,
    refreshClients: () => { refreshCount += 1; },
    getLatestRelease: async () => { throw new Error('should not run'); }
  });

  assert.equal(result.status, 'skipped');
  assert.equal(refreshCount, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'update-state.json'))).skillRefreshPending, undefined);
});

test('throttles successful update checks for 24 hours', async () => {
  const root = createInstall('v0.3.0');
  const now = Date.now();
  fs.writeFileSync(path.join(root, 'update-state.json'), JSON.stringify({
    lastAttemptAt: new Date(now - 1000).toISOString(),
    lastSuccessAt: new Date(now - 1000).toISOString()
  }));
  const result = await maybeAutoUpdate({
    installRoot: root,
    now,
    getLatestRelease: async () => { throw new Error('should not run'); }
  });
  assert.equal(result.status, 'skipped');
});

function createInstall(version) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-launcher-test-'));
  const server = path.join(root, 'releases', version, 'mcp', 'src', 'server.js');
  fs.mkdirSync(path.dirname(server), { recursive: true });
  fs.writeFileSync(server, '// current');
  fs.writeFileSync(path.join(root, 'VERSION'), `${version}\n`);
  return root;
}
