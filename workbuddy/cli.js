import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { Runtime } from '../src/runtime.js';
import { StandaloneHost } from '../src/standalone-host.js';
import { digest } from '../src/protocol.js';
import { safePath } from '../src/workspace.js';
import { publishGithub, loadPublicationSettings } from './publisher.js';

const stateDir = process.env.HUMANDER_STATE_DIR || join(process.env.APPDATA || homedir(), 'Humander');
mkdirSync(stateDir, { recursive: true, mode: 0o700 });
const lockPath = join(stateDir, 'workbuddy.lock');
try { writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 }); }
catch (error) {
  if (error.code !== 'EEXIST') throw error;
  const oldPid = Number(readFileSync(lockPath, 'utf8'));
  let alive = Number.isSafeInteger(oldPid) && oldPid > 0;
  if (alive) { try { process.kill(oldPid, 0); } catch (e) { alive = e.code !== 'ESRCH'; } }
  if (alive) throw new Error(`Humander is already open in process ${oldPid}; use its existing WorkBuddy task`);
  rmSync(lockPath, { force: true });
  writeFileSync(lockPath, String(process.pid), { flag: 'wx', mode: 0o600 });
}
process.once('exit', () => { try { if (readFileSync(lockPath, 'utf8') === String(process.pid)) rmSync(lockPath, { force: true }); } catch {} });
const config = {
  stateDir, standalone: true, autoRun: false,
  publicBaseUrl: process.env.HUMANDER_PUBLIC_BASE_URL ?? '',
  tectonic: process.env.HUMANDER_TECTONIC ?? 'tectonic', pdfinfo: process.env.HUMANDER_PDFINFO ?? 'pdfinfo',
  texCache: process.env.HUMANDER_TEX_CACHE ?? '', bwrap: process.env.HUMANDER_BWRAP ?? '/usr/bin/bwrap',
  sandboxBackend: process.env.HUMANDER_SANDBOX ?? 'auto', docker: process.env.HUMANDER_DOCKER ?? 'docker',
  dockerImage: process.env.HUMANDER_DOCKER_IMAGE ?? 'python:3.12-slim',
};
config.publishRelease = (root, hash, files, signal) => {
  const settings = loadPublicationSettings(stateDir);
  if (!settings) return null;
  return publishGithub(root, hash, files, settings, signal);
};
const host = new StandaloneHost(stateDir);
const runtime = new Runtime(host, config);
const nonce = randomBytes(32).toString('hex');
const uiScript = readFileSync(new URL('./ui.js', import.meta.url), 'utf8');
const baseHtml = readFileSync(new URL('./panel.html', import.meta.url), 'utf8');
const uiHtml = baseHtml.replace('<title>humander · Human-led research</title>',
  `<title>humander · Human-led research</title><meta name="humander-gateway"><meta name="humander-workbuddy"><script>window.HUMANDER_APP_NONCE=${JSON.stringify(nonce)};</script><script>${uiScript.replaceAll('</script', '<\\/script')}</script>`);
const server = new Server({ name: 'humander', version: '0.1.0' }, { capabilities: { tools: {}, resources: {} } });
const output = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value });
const failure = error => ({ content: [{ type: 'text', text: error.message }], isError: true });
const ui = { resourceUri: 'ui://humander/panel' };
const appOnly = { resourceUri: 'ui://humander/panel', visibility: ['app'] };
const checkNonce = value => {
  const a = Buffer.from(String(value ?? '')), b = Buffer.from(nonce);
  if (a.length !== b.length || !timingSafeEqual(a, b)) throw new Error('Human panel capability required');
};
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [
  { name: 'humander_open', description: 'Open the human-led research organization panel. Human decisions are made in its interactive UI.', inputSchema: { type: 'object', properties: {} }, _meta: { ui } },
  { name: 'humander_status', description: 'Read the research phase and published summary without taking a human decision.', inputSchema: { type: 'object', properties: {} } },
  { name: 'humander_advance', description: 'Run one bounded protocol phase after a human has started or ratified a project. Never ratifies goals or adopts results.', inputSchema: { type: 'object', properties: {} } },
  { name: 'humander_app_state', description: 'Read the exact human panel state.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' } }, required: ['nonce'] }, _meta: { ui: appOnly } },
  { name: 'humander_app_models', description: 'Read configured model routes for the human panel.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' }, provider: { type: 'string' } }, required: ['nonce'] }, _meta: { ui: appOnly } },
  { name: 'humander_app_provider_save', description: 'Configure a model provider from the human panel.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' }, provider: { type: 'object' } }, required: ['nonce', 'provider'] }, _meta: { ui: appOnly } },
  { name: 'humander_app_publication_save', description: 'Configure a public GitHub evidence repository from the human panel.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' }, publication: { type: 'object' } }, required: ['nonce', 'publication'] }, _meta: { ui: appOnly } },
  { name: 'humander_app_action', description: 'Apply an explicit human panel action.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' }, input: { type: 'object' } }, required: ['nonce', 'input'] }, _meta: { ui: appOnly } },
  { name: 'humander_app_document', description: 'Download a published organizational document.', inputSchema: { type: 'object', properties: { nonce: { type: 'string' }, path: { type: 'string' } }, required: ['nonce', 'path'] }, _meta: { ui: appOnly } },
] }));
server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
  try {
    const args = params.arguments ?? {};
    switch (params.name) {
      case 'humander_open': return output({ phase: runtime.protocol.state?.phase ?? null, panel: true });
      case 'humander_status': {
        const p = runtime.status().project;
        return output({ phase: p?.phase ?? null, meeting: p?.meeting?.number ?? null, definition: p?.definition?.version ?? null,
          publications: p?.publications?.map(x => ({ id: x.id, number: x.number, summary: x.draft.summary })) ?? [], lastError: runtime.lastError });
      }
      case 'humander_advance': await runtime.pump(); return output({ phase: runtime.protocol.state?.phase ?? null, lastError: runtime.lastError });
      case 'humander_app_state': {
        checkNonce(args.nonce);
        const status = runtime.status();
        if (status.project?.definitionDraft) status.definitionDraftHash = digest(status.project.definitionDraft);
        const publication = loadPublicationSettings(stateDir);
        status.publication = publication ? { owner: publication.owner, repo: publication.repo, branch: publication.branch } : null;
        return output(status);
      }
      case 'humander_app_models': checkNonce(args.nonce); return output(await runtime.modelCatalog(args.provider));
      case 'humander_app_provider_save': {
        checkNonce(args.nonce);
        const p = args.provider ?? {};
        if (!/^[a-z][a-z0-9_-]{0,39}$/.test(p.id ?? '')) throw new Error('Provider ID must begin with a lowercase letter');
        if (!/^https:\/\//.test(p.baseUrl ?? '') && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(?:\/|$)/.test(p.baseUrl ?? '')) throw new Error('Use HTTPS or loopback HTTP for the model endpoint');
        if (!Array.isArray(p.models) || !p.models.length || p.models.some(x => typeof x !== 'string' || !x.trim())) throw new Error('Enter at least one model ID');
        const providers = host.providers();
        providers[p.id] = { name: String(p.name ?? p.id).slice(0, 100), baseUrl: p.baseUrl, models: p.models.slice(0, 50),
          ...(p.apiKey ? { apiKey: String(p.apiKey) } : providers[p.id]?.apiKey ? { apiKey: providers[p.id].apiKey } : {}),
          ...(p.allowNoKey && /^http:\/\/(127\.0\.0\.1|localhost)/.test(p.baseUrl) ? { allowNoKey: true } : {}) };
        writeFileSync(join(stateDir, 'providers.json'), JSON.stringify(providers, null, 2), { mode: 0o600 });
        return output({ ok: true });
      }
      case 'humander_app_publication_save': {
        checkNonce(args.nonce);
        const p = args.publication ?? {};
        if (![p.owner, p.repo, p.branch || 'humander-public'].every(x => /^[A-Za-z0-9_.-]{1,100}$/.test(x ?? ''))) throw new Error('Invalid GitHub owner, repository or branch');
        const previous = loadPublicationSettings(stateDir);
        const token = p.token || previous?.token;
        if (!token) throw new Error('GitHub Contents-write token required');
        writeFileSync(join(stateDir, 'publication.json'), JSON.stringify({ owner: p.owner, repo: p.repo, branch: p.branch || 'humander-public', token }), { mode: 0o600 });
        return output({ ok: true });
      }
      case 'humander_app_action': checkNonce(args.nonce); await runtime.humanAction(args.input); return output({ ok: true, phase: runtime.protocol.state?.phase });
      case 'humander_app_document': {
        checkNonce(args.nonce);
        const path = String(args.path ?? '');
        const publications = runtime.protocol.state?.publications ?? [];
        const allowed = publications.flatMap(p => [p.publication.path, p.publication.definitionPath,
          p.publication.path?.replace('paper.pdf', 'record.json'), p.publication.definitionPath?.replace('paper.pdf', 'record.json')]);
        if (!allowed.includes(path)) throw new Error('Only published organizational documents may be downloaded');
        return output({ data: readFileSync(safePath(runtime.artifacts.root, path)).toString('base64'),
          mimeType: path.endsWith('.pdf') ? 'application/pdf' : 'application/json' });
      }
      default: throw new Error('Unknown tool');
    }
  } catch (error) { return failure(error); }
});
server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: [{ uri: 'ui://humander/panel', name: 'Humander human panel', mimeType: 'text/html;profile=mcp-app' }] }));
server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
  if (params.uri !== 'ui://humander/panel') throw new Error('Unknown resource');
  return { contents: [{ uri: params.uri, text: uiHtml, mimeType: 'text/html;profile=mcp-app', _meta: { ui: { csp: { resourceDomains: [], connectDomains: [] }, prefersBorder: true } } }] };
});

const ticker = setInterval(() => { if (config.autoRun) runtime.changed(); }, 2000);
const close = async () => { clearInterval(ticker); await runtime.dispose(); };
process.once('SIGINT', () => { close().finally(() => process.exit()); });
process.once('SIGTERM', () => { close().finally(() => process.exit()); });
process.stdin.once('end', () => { close().finally(() => process.exit()); });
await server.connect(new StdioServerTransport());
