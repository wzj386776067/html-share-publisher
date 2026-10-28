import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'html-share-read-client-'));
process.env.HTML_SHARE_CONFIG_DIR = root;
const { authStatus, startLogin, findReadableSites, readSiteContent } = await import('../src/service.js');
const { writeCredentials, readCredentials, writePendingAuth, clearPendingAuth } = await import('../src/state.js');
const expiresAt = new Date(Date.now() + 3600000).toISOString();

test('upgrades a valid old authorization, polls it before old credentials, and preserves publishing after denial', async () => {
  writeCredentials({ accessToken: 'old', expiresAt });
  const original = global.fetch;
  let denied = false;
  global.fetch = async (url) => {
    if (url.endsWith('/status')) return Response.json({ status: 'authorized', scopes: ['sites:read'], user: { id: 'b' } });
    if (url.endsWith('/requests')) return Response.json({ requestId: 'req', pollToken: 'poll', authorizationUrl: 'https://example.test/authorize', expiresAt });
    if (url.endsWith('/token')) return denied ? Response.json({ code: 'AUTH_DENIED', error: 'denied' }, { status: 403 })
      : Response.json({ accessToken: 'new', scopes: ['sites:read', 'content:read'], user: { id: 'b' }, expiresAt });
    throw new Error(`unexpected ${url}`);
  };
  try {
    assert.equal((await startLogin({ readContent: true })).status, 'need_auth');
    assert.equal((await authStatus()).scopes.includes('content:read'), true);
    assert.equal(readCredentials().accessToken, 'new');
    writeCredentials({ accessToken: 'old', expiresAt });
    await startLogin({ readContent: true });
    denied = true;
    assert.equal((await authStatus()).upgradeStatus, 'AUTH_DENIED');
    assert.equal(readCredentials().accessToken, 'old');
    writePendingAuth({ requestId: 'expired', expiresAt: '2000-01-01T00:00:00Z' });
    assert.equal((await authStatus()).upgradeStatus, 'expired');
    await assert.rejects(findReadableSites({ query: '销售' }), (e) => e.code === 'CONTENT_READ_AUTH_REQUIRED');
  } finally { global.fetch = original; clearPendingAuth(); }
});

test('uses scoped read endpoints without owner filtering and forwards version/file pagination', async () => {
  const original = global.fetch;
  const urls = [];
  global.fetch = async (url) => {
    if (url.endsWith('/status')) return Response.json({ status: 'authorized', scopes: ['content:read'] });
    urls.push(new URL(url));
    return Response.json(url.includes('readable-sites')
      ? { sites: [{ id: 'site_other', title: '销售报告' }], requiresSelection: true }
      : { text: '资料', versionId: 'v1', hasMore: true, nextOffset: 12 });
  };
  try {
    const result = await findReadableSites({ query: '销售报告.xlsx', page: 2 });
    assert.equal(result.sites[0].id, 'site_other');
    assert.equal(result.requiresSelection, true);
    assert.equal(urls[0].searchParams.get('q'), '销售报告.xlsx');
    assert.equal(urls[0].searchParams.get('page'), '2');
    await assert.rejects(findReadableSites({ query: '销售', reference: 'site_a' }), /只选一个/);
    await assert.rejects(readSiteContent({ siteId: '销售报告' }), /准确 siteId/);
    const content = await readSiteContent({ siteId: 'site_other', versionId: 'v1', file: 'reports/内容.html', offset: 12 });
    assert.equal(urls[1].searchParams.get('file'), 'reports/内容.html');
    assert.equal(urls[1].searchParams.get('versionId'), 'v1');
    assert.equal(content.hasMore, true);
    assert.match(content.handling, /不可信/);
  } finally { global.fetch = original; fs.rmSync(root, { recursive: true, force: true }); }
});
