#!/usr/bin/env node
import { createHash, verify } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY = 'wzj386776067/html-share-publisher';
const RELEASE_API = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
const ASSET_NAME = 'html-share-publisher.tar.gz';
const UPDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const FAILURE_RETRY_MS = 60 * 60 * 1000;
const RELEASE_SIGNING_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAQy+MczWmB86XBwm3YAzVodB3a6mebzNziTjhNQ0sWzk=
-----END PUBLIC KEY-----`;

export async function maybeAutoUpdate(options = {}) {
  const env = options.env || process.env;
  const installRoot = path.resolve(options.installRoot || path.dirname(fileURLToPath(import.meta.url)));
  const logger = options.logger || (() => {});
  const now = options.now || Date.now();
  const statePath = path.join(installRoot, 'update-state.json');
  const currentVersion = readInstalledVersion(installRoot);

  if (isDisabled(env.HTML_SHARE_AUTO_UPDATE)) {
    return { status: 'disabled', currentVersion };
  }

  let state = readJson(statePath);
  if (state.skillRefreshPending) {
    state = retryPendingSkillRefresh({
      state,
      statePath,
      installRoot,
      apiBase: env.HTML_SHARE_API_BASE || 'https://share.bi-cheng.cn',
      logger,
      now,
      refreshClients: options.refreshClients || refreshClientFiles
    });
  }
  const interval = state.lastError ? FAILURE_RETRY_MS : UPDATE_INTERVAL_MS;
  const lastAttempt = Date.parse(state.lastAttemptAt || '');
  const force = options.force ?? isEnabled(env.HTML_SHARE_AUTO_UPDATE_FORCE);
  if (!force && Number.isFinite(lastAttempt) && now - lastAttempt < interval) {
    return { status: 'skipped', currentVersion, nextCheckAt: new Date(lastAttempt + interval).toISOString() };
  }

  writeJson(statePath, { ...state, lastAttemptAt: new Date(now).toISOString() });

  let release;
  try {
    const getLatestRelease = options.getLatestRelease || fetchLatestRelease;
    release = await getLatestRelease({
      apiUrl: env.HTML_SHARE_RELEASE_API || RELEASE_API,
      fetchImpl: options.fetchImpl || fetch
    });
  } catch (error) {
    logger(`自动更新检查失败，继续使用 ${currentVersion || '当前版本'}：${error.message}`);
    writeJson(statePath, {
      ...readJson(statePath),
      lastError: error.message,
      currentVersion
    });
    return { status: 'unavailable', currentVersion, error: error.message };
  }

  const releaseLock = acquireUpdateLock(installRoot, now);
  if (!releaseLock) return { status: 'checking', currentVersion, latestVersion: release.tagName };
  try {
    const effectiveCurrentVersion = readInstalledVersion(installRoot) || currentVersion;
    if (!isNewerVersion(release.tagName, effectiveCurrentVersion)) {
      writeJson(statePath, {
        lastAttemptAt: new Date(now).toISOString(),
        lastSuccessAt: new Date(now).toISOString(),
        latestVersion: release.tagName,
        currentVersion: effectiveCurrentVersion
      });
      return { status: 'current', currentVersion: effectiveCurrentVersion, latestVersion: release.tagName };
    }

    logger(`发现新版本 ${release.tagName}，正在安全升级...`);
    const applyRelease = options.applyRelease || installRelease;
    await applyRelease({
      release,
      installRoot,
      apiBase: env.HTML_SHARE_API_BASE || 'https://share.bi-cheng.cn',
      fetchImpl: options.fetchImpl || fetch
    });
    const nextState = {
      lastAttemptAt: new Date(now).toISOString(),
      lastSuccessAt: new Date(now).toISOString(),
      latestVersion: release.tagName,
      currentVersion: release.tagName
    };
    try {
      const refreshClients = options.refreshClients || refreshClientFiles;
      refreshClients({
        installRoot,
        apiBase: env.HTML_SHARE_API_BASE || 'https://share.bi-cheng.cn'
      });
    } catch (error) {
      nextState.skillRefreshPending = true;
      nextState.skillRefreshError = error.message;
      nextState.lastSkillRefreshAttemptAt = new Date(now).toISOString();
      logger(`客户端 Skill 刷新失败，将自动重试：${error.message}`);
    }
    writeJson(statePath, nextState);
    logger(`已升级到 ${release.tagName}。`);
    return { status: 'updated', previousVersion: effectiveCurrentVersion, currentVersion: release.tagName };
  } catch (error) {
    logger(`自动升级失败，继续使用 ${currentVersion || '当前版本'}：${error.message}`);
    writeJson(statePath, {
      ...readJson(statePath),
      lastError: error.message,
      currentVersion,
      latestVersion: release.tagName
    });
    return { status: 'failed', currentVersion, latestVersion: release.tagName, error: error.message };
  } finally {
    releaseLock();
  }
}

export function isNewerVersion(candidate, current) {
  const candidateParts = parseVersion(candidate);
  const currentParts = parseVersion(current);
  if (!candidateParts || !currentParts) return false;
  for (let index = 0; index < candidateParts.length; index += 1) {
    if (candidateParts[index] !== currentParts[index]) return candidateParts[index] > currentParts[index];
  }
  return false;
}

export function resolveInstalledServer(installRoot) {
  const root = path.resolve(installRoot);
  const version = readInstalledVersion(root);
  const versionedServer = version
    ? path.join(root, 'releases', version, 'mcp', 'src', 'server.js')
    : '';
  if (versionedServer && fs.existsSync(versionedServer)) return versionedServer;

  const currentServer = path.join(root, 'current', 'mcp', 'src', 'server.js');
  if (fs.existsSync(currentServer)) return currentServer;
  throw new Error(`HTML Share MCP server is missing under ${root}. Run the installer to repair it.`);
}

async function fetchLatestRelease({ apiUrl, fetchImpl }) {
  const response = await fetchWithTimeout(fetchImpl, apiUrl, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'html-share-publisher-launcher' }
  }, 5000);
  if (!response.ok) throw new Error(`release check returned ${response.status}`);
  const payload = await response.json();
  const assets = Array.isArray(payload.assets) ? payload.assets : [];
  const archive = assets.find((asset) => asset.name === ASSET_NAME)?.browser_download_url;
  const checksum = assets.find((asset) => asset.name === `${ASSET_NAME}.sha256`)?.browser_download_url;
  const signature = assets.find((asset) => asset.name === `${ASSET_NAME}.sig`)?.browser_download_url;
  if (!/^v\d+\.\d+\.\d+$/.test(String(payload.tag_name || '')) || !archive || !checksum || !signature) {
    throw new Error('latest release metadata is incomplete');
  }
  return { tagName: payload.tag_name, archiveUrl: archive, checksumUrl: checksum, signatureUrl: signature };
}

async function installRelease({ release, installRoot, apiBase, fetchImpl }) {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-auto-update-'));
  try {
    const archivePath = path.join(temporaryRoot, ASSET_NAME);
    const checksumPath = `${archivePath}.sha256`;
    const [archive, checksum, signature] = await Promise.all([
      downloadBuffer(fetchImpl, release.archiveUrl, 30000),
      downloadBuffer(fetchImpl, release.checksumUrl, 10000),
      downloadBuffer(fetchImpl, release.signatureUrl, 10000)
    ]);
    fs.writeFileSync(archivePath, archive);
    fs.writeFileSync(checksumPath, checksum);
    const expected = checksum.toString('utf8').trim().split(/\s+/)[0]?.toLowerCase();
    const actual = createHash('sha256').update(archive).digest('hex');
    if (!expected || expected !== actual) throw new Error('release checksum verification failed');
    if (!verifyReleaseSignature(archive, signature)) throw new Error('release signature verification failed');

    const extractedRoot = path.join(temporaryRoot, 'release');
    fs.mkdirSync(extractedRoot);
    run('tar', ['-xzf', archivePath, '-C', extractedRoot], 'release extraction');
    const payloadDir = path.join(extractedRoot, 'html-share-publisher');
    if (!fs.existsSync(path.join(payloadDir, 'launcher.mjs'))) throw new Error('release payload is missing launcher.mjs');

    if (process.platform === 'win32') {
      run('powershell.exe', [
        '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(payloadDir, 'install.ps1'),
        '-Version', release.tagName,
        '-PayloadDir', payloadDir,
        '-InstallRoot', installRoot,
        '-SkipRegister',
        '-SkipApiCheck'
      ], 'release installation');
    } else {
      run('bash', [
        path.join(payloadDir, 'install.sh'),
        '--version', release.tagName,
        '--payload-dir', payloadDir,
        '--install-root', installRoot,
        '--skip-register',
        '--skip-api-check'
      ], 'release installation');
    }

  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

export function verifyReleaseSignature(archive, signature) {
  try {
    return verify(null, archive, RELEASE_SIGNING_PUBLIC_KEY, signature);
  } catch {
    return false;
  }
}

function retryPendingSkillRefresh({ state, statePath, installRoot, apiBase, logger, now, refreshClients }) {
  const lastAttempt = Date.parse(state.lastSkillRefreshAttemptAt || '');
  if (Number.isFinite(lastAttempt) && now - lastAttempt < FAILURE_RETRY_MS) return state;
  try {
    refreshClients({ installRoot, apiBase });
    const nextState = { ...state, lastSkillRefreshSuccessAt: new Date(now).toISOString() };
    delete nextState.skillRefreshPending;
    delete nextState.skillRefreshError;
    delete nextState.lastSkillRefreshAttemptAt;
    writeJson(statePath, nextState);
    logger('客户端 Skill 已刷新。');
    return nextState;
  } catch (error) {
    const nextState = {
      ...state,
      skillRefreshPending: true,
      skillRefreshError: error.message,
      lastSkillRefreshAttemptAt: new Date(now).toISOString()
    };
    writeJson(statePath, nextState);
    logger(`客户端 Skill 刷新仍未完成，将稍后重试：${error.message}`);
    return nextState;
  }
}

function refreshClientFiles({ installRoot, apiBase }) {
  const version = readInstalledVersion(installRoot);
  const releaseDir = path.join(installRoot, 'releases', version);
  run(process.execPath, [
    path.join(releaseDir, 'installer', 'configure-clients.mjs'),
    '--client', 'auto',
    '--install-root', installRoot,
    '--skill-source', path.join(releaseDir, 'skill'),
    '--server-path', path.join(installRoot, 'launcher.mjs'),
    '--node-path', process.execPath,
    '--api-base', apiBase,
    '--skip-command-registration'
  ], 'client file refresh');
}

function run(command, args, label) {
  const result = spawnSync(command, args, { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${(result.stderr || result.stdout || `exit ${result.status}`).trim()}`);
  }
}

async function downloadBuffer(fetchImpl, url, timeoutMs) {
  const response = await fetchWithTimeout(fetchImpl, url, {}, timeoutMs);
  if (!response.ok) throw new Error(`download returned ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

function fetchWithTimeout(fetchImpl, url, options, timeoutMs) {
  return fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return match ? match.slice(1).map(Number) : null;
}

function readInstalledVersion(installRoot) {
  try {
    return fs.readFileSync(path.join(installRoot, 'VERSION'), 'utf8').trim();
  } catch {
    return '';
  }
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return {};
  }
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (!['EEXIST', 'EPERM'].includes(error.code)) throw error;
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporary, filePath);
  }
}

function acquireUpdateLock(installRoot, now) {
  const lockPath = path.join(installRoot, '.update-lock');
  try {
    fs.mkdirSync(lockPath);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const age = now - fs.statSync(lockPath).mtimeMs;
    if (age <= 10 * 60 * 1000) return null;
    fs.rmSync(lockPath, { recursive: true, force: true });
    fs.mkdirSync(lockPath);
  }
  return () => fs.rmSync(lockPath, { recursive: true, force: true });
}

function isDisabled(value) {
  return ['0', 'false', 'no', 'off'].includes(String(value || '').toLowerCase());
}

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

async function launch() {
  const installRoot = path.dirname(fileURLToPath(import.meta.url));
  const logger = (message) => process.stderr.write(`[html-share] ${message}\n`);
  const result = await maybeAutoUpdate({ installRoot, logger });
  if (process.argv.includes('--check-update')) {
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return;
  }

  const serverPath = resolveInstalledServer(installRoot);
  const child = spawn(process.execPath, [serverPath], { stdio: 'inherit', env: process.env, windowsHide: true });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('error', (error) => {
    logger(`MCP 启动失败：${error.message}`);
    process.exitCode = 1;
  });
  child.on('exit', (code, signal) => {
    process.exitCode = signal ? 1 : (code ?? 1);
  });
}

const invokedPath = process.argv[1] ? fs.realpathSync(path.resolve(process.argv[1])) : '';
const modulePath = fs.realpathSync(fileURLToPath(import.meta.url));
if (invokedPath === modulePath) {
  launch().catch((error) => {
    process.stderr.write(`[html-share] 启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
}
