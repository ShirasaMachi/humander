import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

function loadJson(path, fallback) {
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : fallback;
}

function schema(properties = {}) {
  const out = {}, required = [];
  for (const [name, definition] of Object.entries(properties)) {
    const { required: isRequired, ...rest } = definition;
    out[name] = rest.type === 'json' ? {} : rest.type === 'array' ? { type: 'array', items: rest.items?.type === 'json' ? {} : rest.items ?? {} } : rest;
    if (isRequired) required.push(name);
  }
  return { type: 'object', properties: out, required, additionalProperties: false };
}

export class StandaloneHost {
  constructor(stateDir) {
    this.stateDir = stateDir;
    this.sessionDir = join(stateDir, 'sessions');
    mkdirSync(this.sessionDir, { recursive: true, mode: 0o700 });
    this.agents = { create: options => this.create(options), resume: options => this.create(options) };
    this.sessionPersistence = { flush: async () => {} };
    this.llm = {
      listProviders: () => Object.entries(this.providers()).map(([id, p]) => ({ id, name: p.name ?? id })),
      listModels: async id => (this.providers()[id]?.models ?? []).map(model => ({ id: model, name: model })),
      resolveModelInfo: async (id, model) => {
        if (!this.providers()[id] || !model) throw new Error('Unknown provider or model');
        return { id: model };
      },
    };
  }
  providers() { return loadJson(join(this.stateDir, 'providers.json'), {}); }
  retireSession(id) { rmSync(join(this.sessionDir, `${id}.json`), { force: true }); }
  async create({ agentOptions, setup, sessionId, resumeSessionId }) {
    const id = resumeSessionId ?? sessionId;
    const provider = this.providers()[agentOptions.provider];
    if (!provider) throw new Error(`Provider ${agentOptions.provider} is not configured in providers.json`);
    const registered = new Map(), handlers = new Map(), sections = [];
    const agent = {
      id, status: 'idle',
      cancel: () => { agent.abort?.abort(); },
      whenIdle: () => agent.running ?? Promise.resolve(),
      followup: message => {
        const content = message.content?.filter(p => p.type === 'text').map(p => p.text).join('\n') ?? '';
        agent.running = this.turn(agent, provider, agentOptions.model, content, registered, handlers, sections)
          .catch(error => { for (const cb of handlers.get('agent/error') ?? []) cb({ error }); throw error; })
          .finally(() => { agent.status = 'idle'; agent.running = null; });
      },
    };
    const ctx = {
      tools: { restrict: () => {}, guard: () => {}, register: definition => registered.set(definition.name, definition) },
      systemPrompt: { section: section => sections.push(section.text) },
      on: (event, cb) => { const entries = handlers.get(event) ?? []; entries.push(cb); handlers.set(event, entries); },
    };
    setup(ctx, agent);
    return { agent, dispose: async () => { agent.cancel(); await agent.whenIdle().catch(() => {}); } };
  }
  async turn(agent, provider, model, prompt, registered, handlers, sections) {
    agent.status = 'running'; agent.abort = new AbortController();
    const file = join(this.sessionDir, `${agent.id}.json`);
    const history = loadJson(file, []);
    history.push({ role: 'user', content: prompt });
    const apiKey = provider.apiKey ?? (provider.apiKeyEnv ? process.env[provider.apiKeyEnv] : undefined);
    if (!apiKey && !provider.allowNoKey) throw new Error(`API key missing for ${model}`);
    const base = String(provider.baseUrl ?? '').replace(/\/+$/, '');
    if (!/^https:\/\//.test(base) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/.test(base)) throw new Error('Model baseUrl must use HTTPS or loopback HTTP');
    let ended = false;
    try {
      for (let step = 0; step < 24 && !ended; step++) {
        const next = () => ({ kind: 'continue' });
        for (const cb of handlers.get('agent/pre-step') ?? []) if (cb({}, next)?.kind === 'reject') throw new Error('Model step budget exhausted');
        const response = await fetch(`${base}/chat/completions`, {
          method: 'POST', signal: agent.abort.signal,
          headers: { 'Content-Type': 'application/json', ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) },
          body: JSON.stringify({ model, messages: [{ role: 'system', content: sections.join('\n\n') }, ...history],
            tools: [...registered.values()].map(tool => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: schema(tool.parameters) } })),
            tool_choice: 'auto', max_tokens: 6000 }),
        });
        const body = await response.text();
        let result;
        try { result = JSON.parse(body); }
        catch {
          const endpoint = new URL(`${base}/chat/completions`);
          const detail = body.trim().slice(0, 200) || 'empty response';
          throw new Error(`Model endpoint ${endpoint.origin}${endpoint.pathname} returned HTTP ${response.status} with non-JSON body: ${detail}. Check the provider base URL and API path.`);
        }
        if (!response.ok) throw new Error(`Model HTTP ${response.status}: ${JSON.stringify(result).slice(0, 400)}`);
        const message = result.choices?.[0]?.message;
        if (!message) throw new Error('Model returned no message');
        history.push({ role: 'assistant', content: message.content ?? null, ...(message.tool_calls ? { tool_calls: message.tool_calls } : {}) });
        if (!message.tool_calls?.length) break;
        for (const call of message.tool_calls) {
          const tool = registered.get(call.function.name);
          let output;
          try {
            if (!tool) throw new Error('Unknown protocol tool');
            const args = JSON.parse(call.function.arguments || '{}');
            let terminal = false;
            output = await tool.execute(args, { agent, signal: agent.abort.signal, concludeTurn: () => { terminal = true; } });
            if (terminal) ended = true;
          } catch (error) { output = { error: error.message }; }
          history.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output ?? { ok: true }) });
        }
      }
    } finally {
      writeFileSync(file, JSON.stringify(history), { mode: 0o600 });
      agent.abort = null;
    }
  }
}
