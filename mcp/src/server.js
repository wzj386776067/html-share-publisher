#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import {
  authStatus,
  executePublish,
  findSites,
  precheckPackage,
  preparePublish,
  revokeAuthorization,
  resolveContacts,
  startLogin
} from './service.js';

const server = new McpServer(
  { name: 'html-share-workbench', version: '0.3.1' },
  {
    instructions: [
      '发布或更新本地 HTML 必须走同一个安全流程：',
      '1. 先调用 auth_status；需要钉钉授权时再调用 start_login。',
      '2. 调用 precheck_package 预检文件；存在多个 HTML 时不能猜入口文件。',
      '3. 精确判断新建还是更新；需要更新时用 find_sites 或本地 manifest 定位，不能按相似标题猜测。',
      '4. 选择一种分享范围。仅协作者可见时，用 resolve_contacts 解析人员或部门。外链密码必须恰好为 4 位 ASCII 字母或数字。',
      '5. 调用 prepare_publish，把完整 confirmation 展示给用户。',
      '6. 只有用户在后续明确确认后，才能调用 execute_publish。',
      '更新会创建新版本并保持稳定分享链接。绝不能泄露本机委托令牌。'
    ].join('\n')
  }
);

register('auth_status', {
  title: '检查 HTML 分享授权',
  description: '检查本机是否已获得用户的钉钉委托授权；若用户刚完成授权，也会在此完成令牌交换。',
  inputSchema: {},
  annotations: { readOnlyHint: true }
}, authStatus);

register('start_login', {
  title: '发起钉钉授权',
  description: '创建一次性钉钉授权链接。仅在 auth_status 返回 need_auth 时调用。',
  inputSchema: { clientName: z.string().max(80).optional() },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
}, startLogin);

register('revoke_authorization', {
  title: '撤销 HTML 分享授权',
  description: '按用户明确要求撤销当前 AI 委托令牌，并清除本机凭证。',
  inputSchema: {},
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
}, revokeAuthorization);

register('precheck_package', {
  title: '预检 HTML 作品',
  description: '读取本地目录、HTML 或 ZIP，完成打包与服务端安全预检，不会发布。',
  inputSchema: {
    sourcePath: z.string().min(1).describe('本地作品目录、HTML 文件或 ZIP 的绝对路径'),
    entryFile: z.string().optional().describe('多个 HTML 时明确指定的包内入口路径')
  },
  annotations: { readOnlyHint: true }
}, precheckPackage);

register('find_sites', {
  title: '查找可更新作品',
  description: '按 siteId、标题或分享链接查找当前用户有权管理的作品；有歧义时必须让用户选择。',
  inputSchema: { query: z.string().optional() },
  annotations: { readOnlyHint: true }
}, findSites);

register('resolve_contacts', {
  title: '解析钉钉协作者',
  description: '把用户说出的人员或部门名称解析为稳定钉钉 ID；不支持群聊，不会猜测同名结果。',
  inputSchema: {
    contacts: z.array(z.object({
      type: z.enum(['user', 'department']),
      query: z.string().min(1)
    })).min(1)
  },
  annotations: { readOnlyHint: true }
}, resolveContacts);

register('prepare_publish', {
  title: '准备 HTML 发布',
  description: '校验文件、更新目标和权限，生成 15 分钟有效的最终确认摘要；不会写入服务器。',
  inputSchema: {
    sourcePath: z.string().min(1),
    operation: z.enum(['new', 'update']),
    title: z.string().optional().describe('作品名称，也会出现在分享链接中；省略时新作品使用源文件、ZIP 或目录原名，更新则保留现有名称'),
    siteId: z.string().optional().describe('更新时的 siteId 或稳定分享链接；目录 manifest 可唯一定位时可省略'),
    entryFile: z.string().optional(),
    description: z.string().optional(),
    versionNote: z.string().optional(),
    accessPolicy: z.enum(['collaborators', 'company_link', 'external_link']),
    permissions: z.array(z.object({
      scopeType: z.enum(['user', 'department']),
      scopeId: z.string().min(1),
      scopeName: z.string().min(1)
    })).optional(),
    externalPassword: z.string().length(4).regex(/^[A-Za-z0-9]{4}$/).optional()
      .describe('外链密码必须恰好为 4 位，且仅可包含英文字母或数字；省略则自动生成'),
    externalExpiresAt: z.string().optional()
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false }
}, preparePublish);

register('execute_publish', {
  title: '执行 HTML 发布',
  description: '仅在用户明确确认 prepare_publish 的完整摘要后执行新建或版本更新，并写回本地精准更新 manifest。',
  inputSchema: {
    planId: z.string().min(1),
    confirmed: z.literal(true).describe('只有用户明确确认后才能传 true')
  },
  annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false }
}, executePublish);

function register(name, definition, handler) {
  server.registerTool(name, definition, async (input) => {
    try {
      const result = await handler(input || {});
      return toolResult(result);
    } catch (error) {
      return toolResult({
        status: 'error',
        code: error.code || 'UNEXPECTED_ERROR',
        message: error.message,
        recovery: error.recovery || '检查输入后重试；不要绕过确认或权限限制。'
      }, true);
    }
  });
}

function toolResult(value, isError = false) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {})
  };
}

const transport = new StdioServerTransport();
await server.connect(transport);
