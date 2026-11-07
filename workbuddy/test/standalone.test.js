import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StandaloneHost } from '../../src/standalone-host.js';

test('standalone model session executes a protocol tool and resumes its saved context', async () => {
  const root = mkdtempSync(join(tmpdir(), 'humander-host-'));
  const original = globalThis.fetch;
  try {
    writeFileSync(join(root, 'providers.json'), JSON.stringify({ local: { baseUrl: 'http://127.0.0.1:12345/v1', models: ['mock'], allowNoKey: true } }));
    const observed = [];
    globalThis.fetch = async (_url, options) => {
      const request = JSON.parse(options.body);
      observed.push(request);
      const response = request.messages.at(-1)?.role === 'tool'
        ? { role: 'assistant', content: 'done' }
        : { role: 'assistant', content: null, tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'humander_record', arguments: '{"value":"observed"}' } }] };
      return new Response(JSON.stringify({ choices: [{ message: response }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
    const host = new StandaloneHost(root);
    let calls = 0;
    const setup = ctx => {
      ctx.systemPrompt.section({ text: 'Research protocol.' });
      ctx.tools.register({ name: 'humander_record', description: 'Record a statement', parameters: { value: { type: 'string', required: true } }, execute: async (args, exec) => { calls++; assert.equal(args.value, 'observed'); exec.concludeTurn(); return { ok: true }; } });
    };
    const first = await host.agents.create({ agentOptions: { provider: 'local', model: 'mock' }, setup, sessionId: 'session-one' });
    first.agent.followup({ content: [{ type: 'text', text: 'first turn' }] });
    await first.agent.whenIdle();
    assert.equal(calls, 1);
    assert.equal(observed[0].tools[0].function.parameters.properties.value.type, 'string');
    assert.equal(readFileSync(join(root, 'sessions', 'session-one.json'), 'utf8').includes('observed'), true);
    const resumed = await host.agents.resume({ agentOptions: { provider: 'local', model: 'mock' }, setup, resumeSessionId: 'session-one' });
    resumed.agent.followup({ content: [{ type: 'text', text: 'second turn' }] });
    await resumed.agent.whenIdle();
    assert.equal(calls, 2);
    assert.equal(observed.at(-2).messages.some(m => m.content === 'first turn'), true);
  } finally { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); }
});

test('plain-text model 404 identifies the incorrect endpoint', async () => {
  const root = mkdtempSync(join(tmpdir(), 'humander-host-'));
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response('Not Found', { status: 404 });
    const host = new StandaloneHost(root);
    await assert.rejects(
      host.turn({ id: 'probe', abort: null, status: 'idle' },
        { baseUrl: 'http://127.0.0.1:12345/v1', allowNoKey: true },
        'mock', 'probe', new Map(), new Map(), []),
      /Model endpoint http:\/\/127\.0\.0\.1:12345\/v1\/chat\/completions returned HTTP 404 with non-JSON body: Not Found/,
    );
  } finally { globalThis.fetch = original; rmSync(root, { recursive: true, force: true }); }
});
