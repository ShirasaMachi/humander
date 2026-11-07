import { mkdirSync, readFileSync, writeFileSync, readdirSync, lstatSync, realpathSync, existsSync, cpSync, rmSync } from 'node:fs';
import { resolve, join, relative, dirname, isAbsolute } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { requireThat, text, digest } from './protocol.js';

/** Paths and execution stay below a worker-owned tree, not the host's home. */
export function safePath(root, name, { write = false } = {}) {
  requireThat(typeof name === 'string' && name.length > 0 && !isAbsolute(name), 'Use a relative path');
  const base = realpathSync(root), target = resolve(base, name);
  requireThat(target.startsWith(base + '/'), 'Path escapes workspace');
  let cursor = base;
  for (const part of relative(base, target).split('/')) {
    cursor = join(cursor, part);
    try { requireThat(!lstatSync(cursor).isSymbolicLink(), 'Symlinks are forbidden'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!write) requireThat(existsSync(target) && lstatSync(target).isFile(), 'File not found');
  return target;
}
export function inventory(root) {
  const files = [];
  const walk = (path, prefix = '') => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = join(path, item.name), name = prefix + item.name;
      requireThat(!item.isSymbolicLink(), 'Symlink in artifact');
      if (item.isDirectory()) walk(full, `${name}/`);
      else { requireThat(item.isFile(), 'Special files are forbidden'); files.push({ path: name, bytes: lstatSync(full).size }); }
    }
  };
  walk(root); return files;
}
export function runProcess(command, args, { cwd, env, signal, timeoutMs = 60000, maxOutput = 200000 } = {}) {
  return new Promise((resolvePromise, reject) => {
    signal?.throwIfAborted();
    const child = spawn(command, args, { cwd, env, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', timedOut = false, truncated = false;
    const kill = () => { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const abort = () => kill(); signal?.addEventListener('abort', abort, { once: true });
    const append = data => { output += data.toString(); if (Buffer.byteLength(output) > maxOutput) { output = output.slice(0, maxOutput); truncated = true; kill(); } };
    child.stdout.on('data', append); child.stderr.on('data', append);
    child.on('error', error => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(error); });
    child.on('close', (code, exitSignal) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolvePromise({ code, exitSignal, output, timedOut, truncated, aborted: signal?.aborted ?? false }); });
  });
}
export class Workspaces {
  constructor(root, protocol, config) { this.root = root; this.protocol = protocol; this.config = config; mkdirSync(root, { recursive: true, mode: 0o700 }); }
  path(actor) {
    const m = this.protocol.member(this.protocol.state, actor);
    const path = join(this.root, 'workers', actor, String(m.generation));
    for (const dir of ['src', 'experiments', 'scratch']) mkdirSync(join(path, dir), { recursive: true, mode: 0o700 });
    return path;
  }
  list(actor) { return inventory(this.path(actor)); }
  read(actor, name) {
    const path = safePath(this.path(actor), name);
    requireThat(lstatSync(path).size <= 150000, 'Use smaller files; read limit is 150 KB');
    return readFileSync(path, 'utf8');
  }
  write(actor, name, content, questionId, reason) {
    const s = this.protocol.state; this.protocol.phase(s, 'RESEARCH');
    requireThat(s.definition.questions.some(q => q.id === questionId), 'File must serve a ratified research question');
    text(reason, 'reason for retaining or modifying this file', 2000);
    requireThat(/^(src|experiments|scratch)\//.test(name), 'Only src/, experiments/, scratch/ are writable');
    requireThat(!/\.(md|tex|pdf|docx|html)$/i.test(name), 'Prose is submitted through the paper or meeting tools');
    text(content, 'file content', 150000);
    const root = this.path(actor), path = safePath(root, name, { write: true });
    const files = inventory(root);
    requireThat(files.reduce((n, f) => n + f.bytes, 0) + Buffer.byteLength(content) - (existsSync(path) ? lstatSync(path).size : 0) <= s.rules.maxWorkspaceBytes, 'Workspace budget exhausted');
    requireThat(existsSync(path) || files.length < 150, 'Reuse existing files; workspace file budget exhausted');
    mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content);
    this.protocol.change(actor, 'artifact.purpose', state => {
      state.runtime.filePurposes ??= {};
      state.runtime.filePurposes[`${actor}:${this.protocol.member(state, actor).generation}:${name}`] = { questionId, reason };
    });
    return { path: name, questionId, reason };
  }
  async experiment(actor, request, signal) {
    const s = this.protocol.state; this.protocol.phase(s, 'RESEARCH');
    requireThat(s.definition.questions.some(q => q.id === request.questionId), 'Experiment must address a ratified question');
    for (const key of ['command', 'purpose', 'stopCondition']) text(request[key], key, 4000);
    const source = this.path(actor), files = inventory(source);
    requireThat(files.some(f => f.path.startsWith('src/') || f.path.startsWith('experiments/')), 'Write real code before executing an experiment');
    const sourceHash = digest(files.filter(f => !f.path.startsWith('scratch/')).map(f => [f.path, readFileSync(safePath(source, f.path)).toString('base64')]));
    const dir = join(this.root, 'runs', actor); mkdirSync(dir, { recursive: true });
    const previous = readdirSync(dir).filter(x => x.endsWith('.json')).map(x => JSON.parse(readFileSync(join(dir, x), 'utf8')));
    requireThat(previous.length < 100, 'Experiment budget exhausted; review existing evidence');
    if (previous.some(r => r.sourceHash === sourceHash && r.command === request.command)) text(request.repeatReason, 'reason to repeat unchanged experiment', 2000);
    const runId = randomUUID(), runDir = join(dir, runId), inputDir = join(runDir, 'input'), outputDir = join(runDir, 'output'); mkdirSync(inputDir, { recursive: true }); mkdirSync(outputDir);
    for (const folder of ['src', 'experiments']) { cpSync(join(source, folder), join(inputDir, folder), { recursive: true, dereference: false }); cpSync(join(source, folder), join(outputDir, folder), { recursive: true, dereference: false }); }
    mkdirSync(join(outputDir, 'scratch'));
    const started = Date.now();
    const execution = await this.execute(inputDir, outputDir, request.command, signal);
    const record = { id: runId, worker: actor, generation: this.protocol.member(s, actor).generation, sourceHash, command: request.command, questionId: request.questionId, purpose: request.purpose, stopCondition: request.stopCondition, repeatReason: request.repeatReason ?? null, filePurposes: Object.fromEntries(files.filter(f => !f.path.startsWith('scratch/')).map(f => [f.path, s.runtime.filePurposes?.[`${actor}:${this.protocol.member(s,actor).generation}:${f.path}`] ?? { questionId: request.questionId, reason: 'Input to the declared experiment.' }])), environment: { platform: process.platform, architecture: process.arch, runtime: process.version, filesystem: 'Read-only host /usr; no network; working directory /workspace; frozen source /input.' }, startedAt: started, durationMs: Date.now() - started, ...execution };
    this.validateOutput(outputDir, s.rules.maxWorkspaceBytes);
    inventory(runDir); // Reject symlink/special-file payloads before they can be published.
    writeFileSync(join(dir, `${runId}.json`), JSON.stringify(record, null, 2), { flag: 'wx' });
    return record;
  }
  validateOutput(root, bytes) {
    const files = inventory(root);
    requireThat(files.length <= 150 && files.reduce((n, f) => n + f.bytes, 0) <= bytes, 'Experimental output exceeds the retained file or byte budget');
    requireThat(files.every(f => /^(src|experiments|scratch)\//.test(f.path)), 'Experimental files must use the declared workspace folders');
    requireThat(files.filter(f => !f.path.startsWith('scratch/')).every(f => !/\.(md|tex|pdf|docx|html)$/i.test(f.path)), 'Experiments cannot create extra retained prose documents');
  }
  cleanupPublished() {
    const s = this.protocol.state;
    for (const member of s.members) {
      const workerRoot = join(this.root, 'workers', member.id);
      if (existsSync(workerRoot)) for (const generation of readdirSync(workerRoot)) {
        if (!member.active || member.suspended || generation !== String(member.generation)) rmSync(join(workerRoot, generation), { recursive: true, force: true });
        else { rmSync(join(workerRoot, generation, 'scratch'), { recursive: true, force: true }); mkdirSync(join(workerRoot, generation, 'scratch')); }
      }
      const runs = join(this.root, 'runs', member.id);
      if (existsSync(runs)) for (const file of readdirSync(runs).filter(f => f.endsWith('.json'))) {
        const record = JSON.parse(readFileSync(join(runs, file), 'utf8'));
        if (!member.active || member.suspended || record.generation !== member.generation) {
          rmSync(join(runs, record.id), { recursive: true, force: true }); rmSync(join(runs, file));
        }
      }
    }
    // Reproduction results have been attached to the published meeting record.
    rmSync(join(this.root, 'reproductions', s.meeting.id), { recursive: true, force: true });
  }
  async execute(inputDir, outputDir, command, signal) {
    const bwrap = this.config.bwrap ?? '/usr/bin/bwrap';
    const args = ['--die-with-parent', '--unshare-all', '--new-session', '--cap-drop', 'ALL', '--clearenv', '--ro-bind', '/usr', '/usr', '--symlink', 'usr/bin', '/bin', '--symlink', 'usr/lib', '/lib', '--symlink', 'usr/lib64', '/lib64', '--proc', '/proc', '--dev', '/dev', '--tmpfs', '/tmp', '--ro-bind', inputDir, '/input', '--bind', outputDir, '/workspace', '--chdir', '/workspace', '--setenv', 'PATH', '/usr/bin:/bin', '--setenv', 'HOME', '/tmp', '/bin/bash', '-lc', command];
    const execution = await runProcess(bwrap, args, { signal, timeoutMs: this.protocol.state.rules.experimentSeconds * 1000 });
    // A missing sandbox is an execution failure, never a reason to run on the host.
    requireThat(!/bwrap:.*(namespace|permission|not permitted|No such file)/is.test(execution.output), `Sandbox unavailable: ${execution.output.slice(0, 500)}`);
    return execution;
  }
  async reproduce(reviewer, artifactRoot, runId, reason, signal) {
    const s = this.protocol.state; this.protocol.phase(s, 'REVIEW', 'DISCUSSION');
    requireThat(/^[a-f0-9-]{36}$/.test(runId), 'Invalid run id');
    text(reason, 'specific reproduction question', 2000);
    const original = JSON.parse(readFileSync(safePath(artifactRoot, `experiments/${runId}/record.json`), 'utf8'));
    const source = join(artifactRoot, 'experiments', runId, 'workspace', 'input');
    inventory(source);
    const dir = join(this.root, 'reproductions', s.meeting.id, reviewer, runId); mkdirSync(dir, { recursive: true });
    requireThat(readdirSync(dir).filter(f => f.endsWith('.json')).length < 2, 'Reproduction budget exhausted');
    const id = randomUUID(), output = join(dir, id); mkdirSync(output);
    for (const folder of ['src', 'experiments']) cpSync(join(source, folder), join(output, folder), { recursive: true, dereference: false });
    mkdirSync(join(output, 'scratch'));
    const started = Date.now(), execution = await this.execute(source, output, original.command, signal);
    this.validateOutput(output, s.rules.maxWorkspaceBytes);
    const record = { id, reviewer, runId, reason, command: original.command, durationMs: Date.now() - started, original: { code: original.code, output: original.output }, ...execution, exactMatch: execution.code === original.code && execution.output === original.output };
    writeFileSync(join(dir, `${id}.json`), JSON.stringify(record, null, 2), { flag: 'wx' });
    return record;
  }
  run(actor, runId) { requireThat(/^[a-f0-9-]{36}$/.test(runId), 'Invalid run id'); return JSON.parse(readFileSync(join(this.root, 'runs', actor, `${runId}.json`), 'utf8')); }
}
