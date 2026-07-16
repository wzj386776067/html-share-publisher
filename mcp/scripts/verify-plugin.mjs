import assert from 'node:assert/strict';
import path from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const expectedTools = [
  'auth_status',
  'start_login',
  'revoke_authorization',
  'precheck_package',
  'find_sites',
  'resolve_contacts',
  'prepare_publish',
  'execute_publish'
];

async function main() {
  if (!process.argv[2]) throw new Error('Usage: verify-plugin <server-path>');
  const serverPath = path.resolve(process.argv[2]);
  const transport = new StdioClientTransport({ command: process.execPath, args: [serverPath] });
  const client = new Client({ name: 'html-share-plugin-verifier', version: '1.0.0' });

  try {
    await client.connect(transport);
    const result = await client.listTools();
    assert.deepEqual(result.tools.map((tool) => tool.name), expectedTools);
    console.log(`Verified HTML Share MCP: ${expectedTools.length} tools available.`);
  } finally {
    await client.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
