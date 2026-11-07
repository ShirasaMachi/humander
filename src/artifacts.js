import { mkdirSync, readFileSync, writeFileSync, copyFileSync, cpSync, existsSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { requireThat, text, digest } from './protocol.js';
import { inventory, safePath, runProcess } from './workspace.js';

const templates = fileURLToPath(new URL('../templates/', import.meta.url));
const escapeTex = value => String(value).replace(/[\\{}$&#%_^~]/g, c => ({ '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '%': '\\%', '_': '\\_', '^': '\\textasciicircum{}', '~': '\\textasciitilde{}' }[c]));
const cjk = /[\u2e80-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]/u;
const cjkRuns = /([\u2e80-\u9fff\uac00-\ud7af\u3000-\u303f\uff00-\uffef]+)/u;
const paperText = value => String(value).split(cjkRuns).map(part => cjk.test(part) ? `\\humandercjk{${escapeTex(part)}}` : escapeTex(part)).join('');
const chineseHeading = { abstract:'摘要', introduction:'引言', relatedWork:'相关研究', method:'方法', results:'结果', discussion:'讨论', limitations:'局限性', references:'参考文献',
  'Original request and provenance':'原始需求与来源', 'Research questions':'研究问题', Scope:'研究范围', 'Acceptance conditions':'验收条件', 'Acceptance checks':'验收检查', 'Ratified resource and review rules':'已确认的资源与评审规则', 'Stopping conditions':'终止条件',
  'Problem and acceptance criteria':'问题与验收标准', 'Progress and evidence':'研究进展与证据', Consensus:'共识', Disagreements:'分歧', 'Human decisions required':'需人类决定的事项', 'Submission decisions':'投稿决定', 'Research commitments':'研究承诺', 'Failure experience':'失败经验', 'Earlier failure references':'既有失败记录', 'Amendment and human interventions':'需求修订与人类干预', 'Appeals and publication corrections':'申诉与发表更正', 'Reviewer accountability':'评审责任', 'Acceptance observations':'验收观察' };
const sectionName = (name, language) => language === 'zh' ? (chineseHeading[name] ?? name) : name;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export class Artifacts {
  constructor(root, config, workspaces) { this.root = root; this.config = config; this.workspaces = workspaces; mkdirSync(root, { recursive: true }); }
  async document(dir, title, abstract, sections, signal, language = 'en') {
    mkdirSync(dir, { recursive: true });
    const hasChinese = language === 'zh' || [title, abstract, ...Object.keys(sections), ...Object.values(sections).map(v => typeof v === 'string' ? v : JSON.stringify(v))].some(v => cjk.test(String(v)));
    const font = hasChinese ? `\\makeatletter\n\\font\\humandercjkfont="Noto Serif CJK SC" at 11pt\n\\DeclareRobustCommand{\\humandercjk}[1]{{\\humandercjkfont #1}}\n\\makeatother\n` : '';
    const tex = `\\documentclass[11pt]{article}\n\\usepackage[preprint]{acl}\n\\usepackage{times}\n\\usepackage[T1]{fontenc}\n\\usepackage[utf8]{inputenc}\n${font}${language === 'zh' ? '\\renewcommand{\\abstractname}{\\humandercjk{摘要}}\n' : ''}\\title{${paperText(title)}}\n\\author{humander}\n\\begin{document}\n\\maketitle\n\\begin{abstract}\n${paperText(abstract)}\n\\end{abstract}\n${Object.entries(sections).map(([k, v]) => `\\section{${paperText(sectionName(k, language))}}\n${paperText(typeof v === 'string' ? v : JSON.stringify(v, null, 2))}\n`).join('\n')}\\end{document}\n`;
    writeFileSync(join(dir, 'paper.tex'), tex); copyFileSync(join(templates, 'acl.sty'), join(dir, 'acl.sty'));
    const compiler = this.config.tectonic || 'tectonic';
    const result = await runProcess(compiler, ['--only-cached', '--outdir', dir, join(dir, 'paper.tex')], { signal, timeoutMs: 60000, env: { ...process.env, ...(this.config.texCache ? { XDG_CACHE_HOME: this.config.texCache } : {}) } });
    requireThat(result.code === 0, `Paper compilation failed: ${result.output.slice(-2500)}`);
    const info = await runProcess('pdfinfo', [join(dir, 'paper.pdf')], { signal, timeoutMs: 10000 });
    const pages = Number(info.output.match(/^Pages:\s+(\d+)/m)?.[1]);
    requireThat(pages >= 1 && pages <= 10, `Paper must have 1–10 pages; got ${pages || 'unknown'}`);
    return { pages, hash: sha(readFileSync(join(dir, 'paper.pdf'))) };
  }
  async submission(actor, paper, state, signal) {
    for (const k of ['title', 'contribution']) text(paper[k], k, 4000);
    requireThat(Array.isArray(paper.experiments) && paper.experiments.length > 0 && paper.experiments.length <= 20, 'Select 1–20 existing experiment records');
    requireThat(paper.license === 'MIT', 'An explicit MIT release is required; no implicit licensing');
    const sections = {};
    for (const key of ['abstract', 'introduction', 'relatedWork', 'method', 'results', 'discussion', 'limitations', 'references']) sections[key] = text(paper.sections?.[key], key, 18000);
    const runs = paper.experiments.map(r => this.workspaces.run(actor, r));
    requireThat(runs.every(r => r.generation === state.members.find(m => m.id === actor).generation), 'Select experiments executed by this instance');
    requireThat(runs.every(r => paper.questionIds?.includes(r.questionId)), 'Every selected experiment must map to a declared paper question');
    const tmp = join(this.root, `.pending-${randomUUID()}`); mkdirSync(tmp);
    try {
      const { abstract, ...body } = sections;
      const document = await this.document(tmp, paper.title, abstract, body, signal, state.language);
      for (const run of runs) {
        const dest = join(tmp, 'experiments', run.id); mkdirSync(dest, { recursive: true });
        cpSync(join(this.workspaces.root, 'runs', actor, run.id), join(dest, 'workspace'), { recursive: true });
        rmSync(join(dest, 'workspace', 'output', 'scratch'), { recursive: true, force: true });
        writeFileSync(join(dest, 'record.json'), JSON.stringify(run, null, 2));
      }
      writeFileSync(join(tmp, 'LICENSE'), readFileSync(new URL('../LICENSE', import.meta.url)));
      const contentHash = digest({ title: paper.title, sections, contribution: paper.contribution, runs: runs.map(r => r.sourceHash) });
      const files = inventory(tmp);
      requireThat(files.length <= 2000 && files.reduce((n, f) => n + f.bytes, 0) <= state.rules.maxWorkspaceBytes * 2, 'Artifact release exceeds budget');
      const manifest = files.map(f => ({ ...f, sha256: sha(readFileSync(safePath(tmp, f.path))) }));
      const artifactHash = digest(manifest);
      writeFileSync(join(tmp, 'manifest.json'), JSON.stringify({ artifactHash, files: manifest }, null, 2));
      const release = join(this.root, artifactHash);
      if (existsSync(release)) rmSync(tmp, { recursive: true }); else renameSync(tmp, release);
      requireThat(this.config.publicBaseUrl, 'Configure an externally reachable publicBaseUrl before accepting research submissions');
      const releaseUrl = `${this.config.publicBaseUrl.replace(/\/$/, '')}/releases/${artifactHash}`;
      const response = await fetch(`${releaseUrl}/manifest.json`, { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10000)]), redirect: 'error' });
      requireThat(response.ok, 'The open release is not reachable at publicBaseUrl');
      const publicManifest = await response.json();
      requireThat(digest(publicManifest) === digest({ artifactHash, files: manifest }), 'Public release does not match frozen evidence');
      // A reachable manifest alone does not establish that code and experiment files are public.
      for (let start = 0; start < manifest.length; start += 4) await Promise.all(manifest.slice(start, start + 4).map(async f => {
        const r = await fetch(`${releaseUrl}/${f.path.split('/').map(encodeURIComponent).join('/')}`, { signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(10000)]), redirect: 'error' });
        requireThat(r.ok, `Public artifact unavailable: ${f.path}`);
        const hash = createHash('sha256'); let bytes = 0;
        for await (const chunk of r.body) { bytes += chunk.length; requireThat(bytes <= f.bytes, 'Public artifact exceeds its declared size'); hash.update(chunk); }
        requireThat(bytes === f.bytes && hash.digest('hex') === f.sha256, `Public artifact differs from frozen evidence: ${f.path}`);
      }));
      return { title: paper.title, contribution: paper.contribution, questionIds: paper.questionIds, supersedes: paper.supersedes ?? null, license: paper.license, experiments: runs.map(r => r.id), releaseUrl, artifactHash, contentHash, ...document };
    } catch (error) { if (existsSync(tmp)) rmSync(tmp, { recursive: true }); throw error; }
  }
  async bulletin(state, signal) {
    const m = state.meeting, dir = join(this.root, `meeting-${m.id}`);
    const definitionDir = join(this.root, `definition-${state.definition.version}`);
    if (!existsSync(join(definitionDir, 'paper.pdf'))) await this.document(definitionDir, state.language === 'zh' ? `研究问题定义 ${state.definition.version}` : `Problem Definition ${state.definition.version}`, state.definition.interpretation, {
      'Original request and provenance': { original: state.definition.original, provenance: state.definition.provenance },
      'Research questions': state.definition.questions,
      'Scope': state.definition.scope,
      'Acceptance conditions': state.definition.acceptance,
      'Acceptance checks': state.definition.acceptanceChecks,
      'Ratified resource and review rules': state.definition.rules,
      'Stopping conditions': state.definition.stopping,
    }, signal, state.language);
    writeFileSync(join(definitionDir, 'record.json'), JSON.stringify(state.definition, null, 2));
    const doc = await this.document(dir, state.language === 'zh' ? `会议综述 ${m.number}` : `Meeting Review ${m.number}`, m.draft.summary, {
      'Problem and acceptance criteria': { reviewedVersion: m.definitionVersion, nextVersion: state.definition.version, questions: state.definition.questions, acceptance: state.definition.acceptance },
      'Progress and evidence': m.draft.progress,
      'Consensus': m.draft.consensus,
      'Disagreements': m.draft.dissent,
      'Human decisions required': m.draft.humanDecisions,
      'Submission decisions': m.decisions,
      'Research commitments': m.commitments,
      'Failure experience': m.failures,
      'Earlier failure references': [...new Set(state.failureArchive.map(f => f.evidence))],
      'Amendment and human interventions': { amendment: m.amendment ? { request: m.amendment.request, from: m.amendment.fromVersion, to: m.amendment.toVersion } : null, exclusions: m.excluded, replacements:m.replacements??{}, agenda: m.agenda, missingResponses: m.missingResponses ?? [] },
      'Appeals and publication corrections': m.caseResolutions,
      'Reviewer accountability': { checkedReviews: state.audits.filter(a => a.meetingId === m.id || a.updatedMeetingId === m.id).length, factualErrors: state.audits.filter(a => a.meetingId === m.id && a.status === 'verified' && a.checks.some(c => c.outcome === 'contradicted')).map(a => a.id), plannedRetirements: m.retirements, evidence: 'Exact findings and source hashes are attached in record.json.' },
      'Acceptance observations': state.acceptanceResults.filter(r => r.meetingId === m.id),
    }, signal, state.language);
    const reproductionRoot = join(this.workspaces.root, 'reproductions', m.id);
    const reproductions = existsSync(reproductionRoot) ? inventory(reproductionRoot).filter(f => /^[^/]+\/[^/]+\/[^/]+\.json$/.test(f.path)).map(f => JSON.parse(readFileSync(safePath(reproductionRoot, f.path), 'utf8'))) : [];
    writeFileSync(join(dir, 'record.json'), JSON.stringify({ ...m, cases: state.cases.filter(c=>c.proposed||Object.values(c.attempts).includes(m.id)).map(c=>({...c,...(c.proposed?{status:'resolved',resolution:c.proposed}:{})})), audits: state.audits.filter(a => a.meetingId === m.id || a.updatedMeetingId === m.id), reproductions, acceptanceResults: state.acceptanceResults.filter(r => r.meetingId === m.id), humanRecords: state.humanRecords.filter(r => r.meetingId === m.id || r.at > (state.publications.at(-1)?.publishedAt ?? 0)) }, null, 2));
    return { ...doc, meetingId: m.id, path: `meeting-${m.id}/paper.pdf`, definitionPath: `definition-${state.definition.version}/paper.pdf` };
  }
}
