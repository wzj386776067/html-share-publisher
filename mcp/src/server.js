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
  { name: 'html-share-workbench', version: '0.4.5' },
  {
    instructions: [
      '发布或更新本地 HTML 必须走同一个安全流程：',
      '1. 先调用 auth_status；需要钉钉授权时再调用 start_login。',
      '2. 调用 precheck_package 预检文件；存在多个 HTML 时必须展示全部候选并让用户确认，即使建议入口是 index.html 也不能自行决定。',
      '3. 如果用户未提供作品名称，必须询问用户使用建议名称还是自定义名称；更新时也可以明确选择保留线上名称。',
      '4. 精确判断新建还是更新；需要更新时用 find_sites 或本地 manifest 定位，不能按相似标题猜测。',
      '5. 如果用户未说明分享范围，必须让用户明确选择仅协作者、公司内部链接或外部密码链接，绝不能自行选择。仅协作者可见时，用 resolve_contacts 解析人员或部门。',
      '6. 用户选择外部密码链接但未指定有效期时，不要额外阻塞询问；明确告知将使用默认 90 天且可在最终确认时修改。',
      '7. 调用 prepare_publish 时必须传入用户已明确作出的名称决策和分享范围确认，把完整 confirmation 展示给用户；外部访问必须同时展示有效天数、准确到期时间和是否使用默认值。',
      '8. 展示 confirmation 后停止；用户可以直接确认，也可以先修改外链有效期。用户要求修改时必须重新调用 prepare_publish 并展示新的 confirmation，不能执行旧计划。',
      '9. 只有用户对当前最新 confirmation 明确确认后，才能调用 execute_publish。发布完成后只把 recipientUrl 作为给接收者的链接；external_link 时绝不能用内部 shareUrl 代替外部密码链接。',
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
  inputSchema: {},
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
  description: '按 siteId、标题、新短链接或旧分享链接查找当前用户有权管理的作品；有歧义时必须让用户选择。',
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
    titleDecision: z.enum(['custom', 'use_suggested', 'keep_existing'])
      .describe('用户明确作出的名称决策；custom 必须提供 title，keep_existing 仅可用于更新'),
    title: z.string().optional().describe('仅在 titleDecision=custom 时提供用户输入的作品名称'),
    siteId: z.string().optional().describe('更新时的 siteId 或稳定分享链接；目录 manifest 可唯一定位时可省略'),
    entryFile: z.string().optional(),
    entryFileConfirmed: z.literal(true).optional()
      .describe('存在多个 HTML 时，只有用户明确确认 entryFile 后才能传 true'),
    description: z.string().optional(),
    versionNote: z.string().optional(),
    accessPolicy: z.enum(['collaborators', 'company_link', 'external_link']),
    accessPolicyConfirmed: z.literal(true).describe('只有用户在聊天中明确选择了 accessPolicy 后才能传 true'),
    permissions: z.array(z.object({
      scopeType: z.enum(['user', 'department']),
      scopeId: z.string().min(1),
      scopeName: z.string().min(1)
    })).optional(),
    externalPassword: z.string().length(4).regex(/^[A-Za-z0-9]{4}$/).optional()
      .describe('外链密码必须恰好为 4 位，且仅可包含英文字母或数字；省略则自动生成'),
    externalExpiresAt: z.string().optional()
      .describe('外链准确失效时间；AI 将“30 天”等用户期限换算为未来的 ISO 时间。用户未指定时省略，MCP 使用默认 90 天并在最终确认中明确展示')
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
