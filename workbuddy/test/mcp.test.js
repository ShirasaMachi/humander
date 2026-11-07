import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

test('bundled WorkBuddy MCP server exposes its app and keeps human actions behind the app capability',
  { timeout: 20000, skip: !process.env.HUMANDER_MCP_STDIO_TEST }, async () => {
  const stateDir = mkdtempSync(join(tmpdir(), 'humander-mcp-'));
  const client = new Client({ name: 'humander-test', version: '0.1.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL('../dist/cli.mjs', import.meta.url))],
    env: { ...process.env, HUMANDER_STATE_DIR: stateDir }, stderr: 'pipe' });
  let errors = '';
  transport.stderr?.on('data', chunk => { errors += chunk; });
  try {
    try { await client.connect(transport); } catch (error) { throw new Error(`${error.message}: ${errors}`); }
    const tools = await client.listTools();
    assert.equal(tools.tools.some(t => t.name === 'humander_open' && t._meta?.ui?.resourceUri === 'ui://humander/panel'), true);
    assert.equal(tools.tools.find(t => t.name === 'humander_app_action')._meta.ui.visibility.includes('app'), true);
    const resource = await client.readResource({ uri: 'ui://humander/panel' });
    assert.match(resource.contents[0].text, /humander-workbuddy/);
    assert.equal(resource.contents[0].text.match(/<script\b/g)?.length, 1);
    const panelScript = resource.contents[0].text.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(panelScript);
    assert.doesNotThrow(() => new Function(panelScript));
    const open = await client.callTool({ name: 'humander_open', arguments: {} });
    assert.equal(open.isError, undefined);
    const denied = await client.callTool({ name: 'humander_app_action', arguments: { nonce: 'wrong', input: { action: 'stop' } } });
    assert.equal(denied.isError, true);
  } finally {
    await transport.close();
    rmSync(stateDir, { recursive: true, force: true });
  }
});
