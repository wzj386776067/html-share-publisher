import { randomInt, randomUUID } from 'node:crypto';
import { apiBaseUrl } from './config.js';
import { apiRequest, uploadZip } from './api.js';
import { inspectSource, packageSource, readLocalManifest } from './package-source.js';
import {
  clearCredentials,
  clearPendingAuth,
  deletePlan,
  readCredentials,
  readPendingAuth,
  readPlan,
  writeCredentials,
  writeManifest,
  writePendingAuth,
  writePlan
} from './state.js';

const PLAN_MAX_AGE_MS = 15 * 60 * 1000;
const EXTERNAL_PASSWORD_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export async function startLogin({ clientName = 'Codex HTML 分享助手' } = {}) {
  const current = await checkStoredAuthorization();
  if (current.status === 'authorized') return current;

  const { data } = await apiRequest('/api/mcp/auth/requests', {
    method: 'POST',
    body: { clientName },
    authenticated: false
  });
  writePendingAuth({
    requestId: data.requestId,
    pollToken: data.pollToken,
    authorizationUrl: data.authorizationUrl,
    expiresAt: data.expiresAt
  });
  return {
    status: 'need_auth',
    authorizationUrl: data.authorizationUrl,
    expiresAt: data.expiresAt,
    nextStep: '请用户打开链接并使用钉钉确认授权，然后调用 auth_status。'
  };
}

export async function authStatus() {
  const current = await checkStoredAuthorization();
  if (current.status === 'authorized') return current;

  const pending = readPendingAuth();
  if (!pending) {
    return { status: 'need_auth', nextStep: '调用 start_login 获取钉钉授权链接。' };
  }
  if (new Date(pending.expiresAt).getTime() <= Date.now()) {
    clearPendingAuth();
    return { status: 'need_auth', reason: 'authorization_expired', nextStep: '调用 start_login 重新授权。' };
  }

  const response = await apiRequest('/api/mcp/auth/token', {
    method: 'POST',
    body: { requestId: pending.requestId, pollToken: pending.pollToken },
    authenticated: false
  });
  if (response.status === 202) {
    return {
      status: 'pending',
      authorizationUrl: pending.authorizationUrl,
      expiresAt: pending.expiresAt,
      nextStep: '等待用户在浏览器中确认授权，然后再次调用 auth_status。'
    };
  }

  writeCredentials({
    apiBaseUrl,
    accessToken: response.data.accessToken,
    expiresAt: response.data.expiresAt,
    user: response.data.user
  });
  clearPendingAuth();
  return {
    status: 'authorized',
    user: response.data.user,
    expiresAt: response.data.expiresAt,
    scopes: response.data.scopes
  };
}

export async function revokeAuthorization() {
  const credentials = readCredentials();
  if (!credentials?.accessToken) {
    clearPendingAuth();
    return { status: 'not_authorized' };
  }
  await apiRequest('/api/mcp/auth/revoke', { method: 'POST' });
  clearCredentials();
  clearPendingAuth();
  return { status: 'revoked', nextStep: '下次发布时需要重新完成钉钉授权。' };
}

export async function precheckPackage({ sourcePath, entryFile = '' }) {
  await requireAuthorization();
  const source = inspectSource(sourcePath);
  const packaged = packageSource(source);
  try {
    const { data } = await uploadZip('/api/uploads/precheck', packaged.zipPath, {
      ...(entryFile ? { 'x-entry-file': encodeURIComponent(entryFile) } : {})
    });
    const localManifest = readLocalManifest(source);
    return {
      status: 'ready',
      sourcePath: source.sourcePath,
      sourceKind: source.kind,
      fingerprint: source.fingerprint,
      htmlCandidates: data.htmlCandidates,
      entryFile: data.entryFile,
      requiresEntrySelection: data.requiresEntrySelection,
      fileCount: data.fileCount,
      totalBytes: data.totalBytes,
      warnings: source.warnings,
      localBinding: localManifest,
      suggestedOperation: localManifest?.siteId ? 'update' : 'new'
    };
  } finally {
    packaged.cleanup();
  }
}

export async function findSites({ query = '' } = {}) {
  const authorization = await requireAuthorization();
  const { data } = await apiRequest('/api/sites');
  const normalizedQuery = normalize(query);
  const sites = data.sites
    .filter((site) => authorization.user.role === 'admin' || site.ownerId === authorization.user.id)
    .filter((site) => !normalizedQuery || siteSearchText(site).includes(normalizedQuery))
    .map(siteSummary);
  return { status: 'ok', sites, count: sites.length };
}

export async function resolveContacts({ contacts }) {
  await requireAuthorization();
  const resolved = [];
  const unresolved = [];
  for (const contact of contacts) {
    if (!['user', 'department'].includes(contact.type)) {
      unresolved.push({ ...contact, reason: '仅支持人员和部门。' });
      continue;
    }
    const { data } = await apiRequest(
      `/api/dingtalk/contacts/search?type=${contact.type}&q=${encodeURIComponent(contact.query)}&limit=20`
    );
    const candidates = data.scopes || [];
    const exact = candidates.filter((candidate) => (
      normalize(candidate.scopeName) === normalize(contact.query)
      || String(candidate.scopeId) === String(contact.query)
    ));
    if (exact.length === 1) resolved.push(exact[0]);
    else unresolved.push({ ...contact, reason: exact.length > 1 ? '存在多个同名结果。' : '没有唯一匹配。', candidates });
  }
  return {
    status: unresolved.length ? 'needs_clarification' : 'resolved',
    resolved,
    unresolved,
    nextStep: unresolved.length ? '请用户从候选项中明确选择，不能猜测协作者。' : '可把 resolved 原样传给 prepare_publish.permissions。'
  };
}

export async function preparePublish(input) {
  const authorization = await requireAuthorization();
  const source = inspectSource(input.sourcePath);
  const precheck = await precheckPackage({ sourcePath: input.sourcePath, entryFile: input.entryFile || '' });
  if (precheck.requiresEntrySelection && !input.entryFile) {
    throw toolError('ENTRY_REQUIRED', '作品包含多个 HTML，需要明确入口文件。', `请从以下文件选择：${precheck.htmlCandidates.join('、')}`);
  }

  const operation = input.operation;
  let site = null;
  if (operation === 'update') {
    const localManifest = readLocalManifest(source);
    const targetId = normalizeSiteId(input.siteId || localManifest?.siteId || '');
    if (!targetId) {
      throw toolError('UPDATE_TARGET_REQUIRED', '没有找到唯一的更新目标。', '请提供 siteId 或在作品目录保留 .htmlshare.json。');
    }
    site = await findManageableSite(targetId, authorization.user);
  } else if (!String(input.title || '').trim()) {
    throw toolError('TITLE_REQUIRED', '新作品必须提供标题。', '询问用户作品标题后重新准备发布。');
  }

  const accessPolicy = input.accessPolicy;
  const permissions = accessPolicy === 'collaborators'
    ? (input.permissions ?? site?.permissions ?? [])
    : [];
  const externalPassword = accessPolicy === 'external_link'
    ? normalizeExternalPassword(input.externalPassword)
    : '';
  const externalExpiresAt = accessPolicy === 'external_link'
    ? normalizeFutureDate(input.externalExpiresAt || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000))
    : '';
  const plan = {
    id: `plan_${randomUUID()}`,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + PLAN_MAX_AGE_MS).toISOString(),
    sourcePath: source.sourcePath,
    sourceRoot: source.sourceRoot,
    manifestPath: source.manifestPath,
    fingerprint: source.fingerprint,
    operation,
    siteId: site?.id || '',
    title: String(input.title || site?.title || '').trim(),
    description: String(input.description ?? site?.description ?? '').trim(),
    entryFile: precheck.entryFile,
    versionNote: String(input.versionNote || '').trim(),
    accessPolicy,
    permissions,
    externalPassword,
    externalExpiresAt,
    precheck: {
      fileCount: precheck.fileCount,
      totalBytes: precheck.totalBytes,
      contentHash: precheck.fingerprint
    }
  };
  writePlan(plan);

  return {
    status: 'confirmation_required',
    planId: plan.id,
    expiresAt: plan.expiresAt,
    confirmation: confirmationSummary(plan, site),
    nextStep: '把 confirmation 完整展示给用户；只有用户明确同意后，才调用 execute_publish 并传 confirmed=true。'
  };
}

export async function executePublish({ planId, confirmed }) {
  if (confirmed !== true) {
    throw toolError('CONFIRMATION_REQUIRED', '发布尚未获得用户明确确认。', '展示 prepare_publish 返回的确认摘要，并等待用户明确同意。');
  }
  await requireAuthorization();
  const plan = readPlan(planId);
  if (!plan) throw toolError('PLAN_NOT_FOUND', '发布计划不存在或已清理。', '重新调用 prepare_publish。');
  if (new Date(plan.expiresAt).getTime() <= Date.now()) {
    deletePlan(planId);
    throw toolError('PLAN_EXPIRED', '发布计划已过期。', '重新预检并确认，避免使用过时信息发布。');
  }
  const source = inspectSource(plan.sourcePath);
  if (source.fingerprint !== plan.fingerprint) {
    throw toolError('SOURCE_CHANGED', '确认后本地文件发生了变化，已停止发布。', '重新调用 prepare_publish，让用户确认最新内容。');
  }

  const packaged = packageSource(source);
  try {
    let site;
    if (plan.operation === 'new') site = await createSite(plan, packaged.zipPath);
    else site = await updateSite(plan, packaged.zipPath);

    let external = null;
    if (plan.accessPolicy === 'external_link') {
      const response = await apiRequest(`/api/sites/${encodeURIComponent(site.id)}/external-share`, {
        method: 'POST',
        body: { password: plan.externalPassword, expiresAt: plan.externalExpiresAt }
      });
      site = response.data.site;
      external = response.data.externalShare;
    }
    const { data: remoteManifest } = await apiRequest(`/api/sites/${encodeURIComponent(site.id)}/manifest`);
    const localManifest = {
      schemaVersion: 1,
      siteId: site.id,
      title: site.title,
      shareUrl: remoteManifest.shareUrl,
      sourceRoot: '.',
      entryFile: site.currentVersion.entryFile,
      lastVersionId: site.currentVersion.id,
      lastPublishedAt: new Date().toISOString(),
      lastContentHash: site.currentVersion.contentHash
    };
    writeManifest(plan.manifestPath, localManifest);
    deletePlan(planId);
    return {
      status: 'published',
      operation: plan.operation,
      siteId: site.id,
      versionId: site.currentVersion.id,
      versionNumber: site.currentVersion.versionNumber,
      title: site.title,
      entryFile: site.currentVersion.entryFile,
      accessPolicy: site.accessPolicy,
      shareUrl: remoteManifest.shareUrl,
      externalUrl: external?.externalUrl || '',
      externalPassword: plan.externalPassword,
      externalExpiresAt: plan.externalExpiresAt,
      manifestPath: plan.manifestPath
    };
  } finally {
    packaged.cleanup();
  }
}

async function createSite(plan, zipPath) {
  const metadata = {
    title: plan.title,
    description: plan.description,
    alias: '',
    accessPolicy: plan.accessPolicy === 'external_link' ? 'collaborators' : plan.accessPolicy,
    permissions: plan.permissions,
    entryFile: plan.entryFile,
    versionNote: plan.versionNote
  };
  return (await uploadZip('/api/sites', zipPath, {
    'x-site-metadata': encodeURIComponent(JSON.stringify(metadata))
  })).data;
}

async function updateSite(plan, zipPath) {
  const current = (await apiRequest(`/api/sites/${encodeURIComponent(plan.siteId)}`)).data;
  if (current.externalShare) {
    await apiRequest(`/api/sites/${encodeURIComponent(plan.siteId)}/external-share-close`, { method: 'POST' });
  }
  await apiRequest(`/api/sites/${encodeURIComponent(plan.siteId)}`, {
    method: 'POST',
    body: {
      title: plan.title,
      description: plan.description,
      alias: current.alias || '',
      accessPolicy: plan.accessPolicy === 'external_link' ? 'collaborators' : plan.accessPolicy,
      permissions: plan.permissions
    }
  });
  return (await uploadZip(`/api/sites/${encodeURIComponent(plan.siteId)}/versions`, zipPath, {
    'x-version-entry-file': encodeURIComponent(plan.entryFile),
    ...(plan.versionNote ? { 'x-version-note': encodeURIComponent(plan.versionNote) } : {})
  })).data;
}

async function findManageableSite(siteId, user) {
  const { data } = await apiRequest('/api/sites');
  const site = data.sites.find((candidate) => candidate.id === siteId);
  if (!site) throw toolError('SITE_NOT_FOUND', `找不到作品 ${siteId}。`, '检查 siteId 或分享链接，不能按相似标题猜测。');
  if (user.role !== 'admin' && site.ownerId !== user.id) {
    throw toolError('SITE_NOT_MANAGEABLE', '当前账号不是该作品的发布者，不能更新。', '请切换到发布者账号，或新建作品。');
  }
  return site;
}

async function requireAuthorization() {
  const status = await authStatus();
  if (status.status !== 'authorized') {
    throw toolError('AUTH_REQUIRED', '尚未完成钉钉授权。', status.authorizationUrl || status.nextStep);
  }
  return status;
}

async function checkStoredAuthorization() {
  const credentials = readCredentials();
  if (!credentials?.accessToken) return { status: 'need_auth' };
  if (new Date(credentials.expiresAt).getTime() <= Date.now()) {
    clearCredentials();
    return { status: 'need_auth', reason: 'token_expired' };
  }
  try {
    return (await apiRequest('/api/mcp/auth/status')).data;
  } catch (error) {
    if (error.status === 401) {
      clearCredentials();
      return { status: 'need_auth', reason: 'token_invalid' };
    }
    throw error;
  }
}

function confirmationSummary(plan, site) {
  return {
    title: plan.title,
    operation: plan.operation === 'new' ? '新建作品' : '更新已有作品',
    updateTarget: site ? { siteId: site.id, title: site.title, currentVersion: site.currentVersion?.versionNumber } : null,
    entryFile: plan.entryFile,
    package: { fileCount: plan.precheck.fileCount, totalBytes: plan.precheck.totalBytes },
    accessPolicy: plan.accessPolicy,
    collaborators: plan.permissions.map((permission) => ({ type: permission.scopeType, id: permission.scopeId, name: permission.scopeName })),
    externalAccess: plan.accessPolicy === 'external_link'
      ? { password: plan.externalPassword, expiresAt: plan.externalExpiresAt }
      : null,
    stableLinkWillRemain: plan.operation === 'update'
  };
}

function siteSummary(site) {
  return {
    siteId: site.id,
    title: site.title,
    ownerName: site.ownerName,
    status: site.status,
    accessPolicy: site.accessPolicy,
    currentVersion: site.currentVersion?.versionNumber || null,
    entryFile: site.currentVersion?.entryFile || ''
  };
}

function siteSearchText(site) {
  return normalize([site.id, site.title, site.alias, site.ownerName].join(' '));
}

function normalizeSiteId(value) {
  const text = String(value || '').trim();
  if (/^site_[A-Za-z0-9-]+$/.test(text)) return text;
  try {
    const match = new URL(text).pathname.match(/\/s\/(site_[^/]+)/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

function normalize(value) {
  return String(value || '').trim().toLocaleLowerCase('zh-CN');
}

function normalizeFutureDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
    throw toolError('INVALID_EXPIRY', '外部链接有效期必须晚于当前时间。');
  }
  return date.toISOString();
}

export function generateExternalPassword() {
  return Array.from(
    { length: 4 },
    () => EXTERNAL_PASSWORD_ALPHABET[randomInt(EXTERNAL_PASSWORD_ALPHABET.length)]
  ).join('');
}

function normalizeExternalPassword(value) {
  const password = String(value || generateExternalPassword()).trim();
  if (!/^[A-Za-z0-9]{4}$/.test(password)) {
    throw toolError(
      'INVALID_EXTERNAL_PASSWORD',
      '外链密码必须为 4 位，且仅可包含字母或数字。',
      '请提供恰好 4 位英文字母或数字，或省略密码让系统自动生成。'
    );
  }
  return password;
}

function toolError(code, message, recovery = '') {
  const error = new Error(message);
  error.code = code;
  error.recovery = recovery;
  return error;
}
