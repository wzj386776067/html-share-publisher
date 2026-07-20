import fs from 'node:fs';

import { apiBaseUrl, clientName } from './config.js';
import { readCredentials } from './state.js';

export class ApiError extends Error {
  constructor(message, { status = 500, code = 'API_ERROR', recovery = '', details = null } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.recovery = recovery;
    this.details = details;
  }
}

export async function apiRequest(pathname, { method = 'GET', body, headers = {}, authenticated = true } = {}) {
  const requestHeaders = {
    'x-html-share-client-name': clientName,
    ...headers
  };
  if (authenticated) {
    const credentials = readCredentials();
    if (!credentials?.accessToken) {
      throw new ApiError('尚未完成钉钉授权。', {
        status: 401,
        code: 'AUTH_REQUIRED',
        recovery: '先调用 start_login，再调用 auth_status 完成授权。'
      });
    }
    requestHeaders.authorization = `Bearer ${credentials.accessToken}`;
  }

  let payload = body;
  if (body && !Buffer.isBuffer(body) && !(body instanceof Uint8Array)) {
    requestHeaders['content-type'] = requestHeaders['content-type'] || 'application/json';
    payload = requestHeaders['content-type'] === 'application/json' ? JSON.stringify(body) : body;
  }

  const fetchOptions = { method, headers: requestHeaders, body: payload };
  if (payload && typeof payload.pipe === 'function') fetchOptions.duplex = 'half';
  const response = await fetch(`${apiBaseUrl}${pathname}`, fetchOptions);
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok && response.status !== 202) {
    throw new ApiError(result?.error || `工作台 API 返回 ${response.status}`, {
      status: response.status,
      code: result?.code || 'API_ERROR',
      recovery: result?.recovery || '',
      details: result
    });
  }
  return { status: response.status, data: result };
}

export async function uploadZip(pathname, zipPath, headers = {}) {
  const stat = fs.statSync(zipPath);
  return await apiRequest(pathname, {
    method: 'POST',
    headers: {
      'content-type': 'application/zip',
      'content-length': String(stat.size),
      ...headers
    },
    body: fs.createReadStream(zipPath)
  });
}
