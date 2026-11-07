import z from '@deepseek-ai/schemastery';
import { mkdirSync, openSync, closeSync, unlinkSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { Runtime } from './runtime.js';
import { startPanel } from './panel.js';
import { forwardPanel, forwardPublicRelease } from './gateway.js';

export const name = 'humander';
export const inject = ['agents', 'tools', 'systemPrompt', 'sessionPersistence', 'llm'];
export const Config = z.object({
  stateDir: z.string().default('').description('Absolute private host directory. Empty uses DSH_HOME/humander-state.'),
  port: z.number().default(3088).description('Loopback human panel port; use 0 for an ephemeral test port.'),
  autoRun: z.boolean().default(false).description('Continue admitted research and meeting phases within budgets.'),
  publicBaseUrl: z.string().default('').description('Public origin proxying /releases/. Required before research submissions.'),
  tectonic: z.string().default('tectonic').description('TeX compiler executable with a prepared dependency cache.'),
  pdfinfo: z.string().default('pdfinfo').description('PDF page counter executable, such as pdfinfo.exe on Windows.'),
  texCache: z.string().default('').description('Optional XDG_CACHE_HOME for offline TeX compilation.'),
  bwrap: z.string().default('/usr/bin/bwrap').description('Bubblewrap executable. Experiments fail closed if unavailable.'),
  sandboxBackend: z.union(['auto', 'bubblewrap', 'docker']).default('auto').description('Auto uses Docker on Windows and Bubblewrap on Linux.'),
  docker: z.string().default('docker').description('Docker Desktop CLI on Windows.'),
  dockerImage: z.string().default('python:3.12-slim').description('Pre-pulled Linux container image for isolated Windows experiments.'),
});

export async function apply(ctx, config) {
  config = { ...config, stateDir: config.stateDir || join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'humander-state') };
  if (!isAbsolute(config.stateDir)) throw new Error('humander stateDir must be absolute');
  mkdirSync(config.stateDir, { recursive: true, mode: 0o700 });
  const lockPath = join(config.stateDir, 'runtime.lock');
  let lock;
  try { lock = openSync(lockPath, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(readFileSync(lockPath, 'utf8'));
    try { process.kill(pid, 0); throw new Error('Another humander runtime owns this state directory'); }
    catch (probe) { if (probe.code !== 'ESRCH') throw probe; }
    unlinkSync(lockPath); lock = openSync(lockPath, 'wx', 0o600);
  }
  const { writeSync } = await import('node:fs'); writeSync(lock, String(process.pid));
  let runtime, panel, timer;
  try {
    runtime = new Runtime(ctx, config);
    panel = await startPanel(runtime, config);
    ctx.inject(['webServer', 'connection'], webCtx => {
      webCtx.effect(() => webCtx.webServer.register({
        kind: 'prefix', path: '/humander',
        handler: (req, res) => {
          const admission = webCtx.connection.admit(req);
          if ('rejection' in admission) { res.writeHead(admission.rejection); res.end(); return; }
          if (admission.peer.principal.kind !== 'owner') { res.writeHead(403); res.end(); return; }
          let secure = webCtx.webServer.protocol === 'https:';
          if (req.headers.origin) {
            try { secure = new URL(req.headers.origin).protocol === 'https:'; }
            catch { res.writeHead(403); res.end(); return; }
          }
          forwardPanel(req, res, { mount: '/humander', port: panel.port, tokenPath: panel.tokenPath, secure });
        },
      }), 'humander: authenticated panel route');
      if (config.publicBaseUrl) webCtx.effect(() => webCtx.webServer.register({
        kind: 'prefix', path: '/releases', handler: (req, res) => forwardPublicRelease(req, res, panel.port),
      }), 'humander: public frozen releases');
    });
    // This timer only advances already-open protocol phases and checks deadlines.
    // It never selects research tasks or decides whether to convene a meeting.
    timer = setInterval(() => { if (config.autoRun) runtime.changed(); }, 2000); timer.unref();
    ctx.on('dispose', async () => {
      clearInterval(timer); await panel.close(); await runtime.dispose(); closeSync(lock); unlinkSync(lockPath);
    });
    console.info(`[humander] Human panel: http://127.0.0.1:${panel.port}; operator token file: ${panel.tokenPath}`);
  } catch (error) {
    clearInterval(timer); if (panel) await panel.close(); if (runtime) await runtime.dispose(); closeSync(lock); unlinkSync(lockPath); throw error;
  }
}
