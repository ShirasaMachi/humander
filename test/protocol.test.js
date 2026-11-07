import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, symlinkSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Protocol, digest } from '../src/protocol.js';
import { Workspaces, safePath } from '../src/workspace.js';
import { Artifacts } from '../src/artifacts.js';
import { forwardPanel } from '../src/gateway.js';
import { startPanel } from '../src/panel.js';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';

const roster = ['a', 'b', 'c', 'd'].map(id => ({ id, provider: 'test', model: `model-${id}` }));
const definition = { interpretation: 'Find a faster exact sum.', scope: 'Small integer arrays', acceptance: 'Equal exact sums; compare measured work.', stopping: 'Stop after two meetings.', provenance: 'Human-stated: exact answer. Worker-proposed: operation count.', acceptanceChecks: [{ id: 'A1', questionId: 'Q1', outcome: 'Exact sum', evaluation: 'Fixed small arrays', method: 'Execute comparison', checker: 'human', pass: 'Exact equality', failure: 'Record failure or inconclusive evidence' }], questions: [{ id: 'Q1', text: 'Can fewer operations preserve exactness?' }] };
const commitment = { questionId: 'Q1', investigation: 'Compare algorithms', expectedObservation: 'Operation counts and exact output', budget: 'One experiment', stopping: 'One fixed input batch', priorFailures: 'No earlier failure applies.' };
const bulletin = { summary: 'Evidence and limitations.', progress: 'Experiments addressed Q1.', consensus: 'Use the agreed input.', dissent: 'Performance remains uncertain.', humanDecisions: 'None.' };
function setup(t) {
  const root = mkdtempSync(join(tmpdir(), 'humander-test-')); let now = 1000;
  const p = new Protocol(join(root, 'state.sqlite'), { now: () => now });
  t.after(() => { try { p.close(); } catch {} rmSync(root, { recursive: true, force: true }); });
  p.open('Make exact summation faster.', roster);
  return { p, root, advance: () => { now += 1000000; } };
}
function define(p) {
  for (const w of roster) p.statement(w.id, 'Discuss exactness and evidence.');
  p.draftDefinition(definition); const hash = digest(p.state.definitionDraft);
  for (const w of roster) p.checkDefinition(w.id, hash, 'Faithful interpretation.');
  p.ratify(hash);
}
function publish(p) {
  for (const w of roster) p.commit(w.id, commitment);
  p.decide(); p.draftBulletin(bulletin);
  for (const w of roster) p.checkBulletin(w.id, digest(p.state.meeting.draft), true, 'Checked attribution and evidence.');
  p.preparePublication(); p.publish({ meetingId: p.state.meeting.id, pages: 2, hash: 'fixture-receipt' });
}
function paper(author) { return { title: `Paper ${author}`, contribution: 'A reproducible negative finding.', questionIds: ['Q1'], releaseUrl: `https://example.invalid/${author}`, artifactHash: author.repeat(64), contentHash: `content-${author}`, license: 'MIT', experiments: [`run-${author}`], pages: 3 }; }
function score(p, reviewer, author, overall = 4) { p.review(reviewer, author, { artifactHash: paper(author).artifactHash, soundness: 4, excitement: 3, overall, confidence: 3, summary: 'Bounded contribution.', evidence: 'Claim C1 matches run output.', limitations: 'Small input.', reproducibility: 'Code and command inspected.', majorCorrectnessObjection: false }); }

test('requirements are discussed, inspected and human-ratified before research', t => {
  const { p } = setup(t);
  const empty = new Protocol(':memory:');
  try { assert.throws(() => empty.open('A goal', roster.map((w, i) => i ? w : { ...w, id: 'human' })), /Reserved worker ID/); }
  finally { empty.close(); }
  assert.throws(() => p.callMeeting('a', 'Ready'), /requires/);
  assert.throws(() => p.draftDefinition(definition), /All workers/);
  for (const w of roster) p.statement(w.id, 'Discuss the original request.');
  p.draftDefinition(definition);
  assert.throws(() => p.ratify(digest(p.state.definitionDraft)), /Every worker/);
  for (const w of roster) p.checkDefinition(w.id, digest(p.state.definitionDraft), 'Checked');
  assert.throws(() => p.ratify('stale'), /Stale/);
  p.clarify('Keep exactness as the primary acceptance condition.');
  assert.equal(p.state.definitionDraft, null);
  assert.deepEqual(p.state.definitionChecks, {});
  assert.equal(p.state.meeting.statements.at(-1).actor, 'human');
  for (const w of roster) p.statement(w.id, 'Discuss the clarified request.');
  p.draftDefinition(definition);
  for (const w of roster) p.checkDefinition(w.id, digest(p.state.definitionDraft), 'Rechecked');
  p.ratify(digest(p.state.definitionDraft));
  assert.equal(p.state.phase, 'DISCUSSION');
  assert.deepEqual(JSON.parse(JSON.stringify(p.view('a'))), p.view('a'), 'Tool state is lossless JSON');
});

test('one worker opens a meeting; repeated calls merge; mandatory submission cannot be bypassed', t => {
  const { p, advance } = setup(t); define(p); publish(p);
  p.callMeeting('a', 'An informative failure'); const meetingId = p.state.meeting.id;
  p.callMeeting('b', 'Another observation'); assert.equal(p.state.meeting.id, meetingId);
  p.submit('a', paper('a'));
  assert.throws(() => p.submit('a', paper('a')), /Exactly one/);
  assert.throws(() => p.startReview(), /still open/);
  advance(); p.startReview(); assert.equal(p.state.meeting.decisions.b.reason, 'submission_failure');
});

test('self-review, stale evidence and premature disclosure are blocked', t => {
  const { p } = setup(t); define(p); publish(p); p.callMeeting('a', 'Ready');
  for (const w of roster) p.submit(w.id, paper(w.id)); p.startReview();
  assert.throws(() => score(p, 'a', 'a'), /Self/);
  score(p, 'b', 'a'); assert.equal(Object.keys(p.view('c').meeting.reviews).length, 0);
  assert.equal(Object.keys(p.view('b').meeting.reviews).length, 1);
  assert.throws(() => p.review('c', 'a', { artifactHash: 'other' }), /frozen/);
});

test('valuable failure can be accepted; rejection resets only after publication; restart persists state', t => {
  const { p, root } = setup(t); define(p); publish(p); p.callMeeting('a', 'Failure analysis ready');
  for (const w of roster) p.submit(w.id, paper(w.id)); p.startReview();
  for (const a of roster) for (const r of roster) if (r.id !== a.id) score(p, r.id, a.id, { a: 5, b: 4.5, c: 4, d: 2 }[a.id]);
  p.releaseReviews(); for (const w of roster) p.commit(w.id, commitment); p.decide();
  assert.equal(p.state.meeting.decisions.a.outcome, 'accepted');
  assert.equal(p.state.meeting.decisions.c.reason, 'capacity');
  assert.equal(p.state.meeting.decisions.d.reason, 'quality');
  assert.equal(p.state.members.find(m => m.id === 'd').generation, 0);
  p.draftBulletin(bulletin);
  assert.throws(() => p.preparePublication(), /All workers/);
  for (const w of roster) p.checkBulletin(w.id, digest(p.state.meeting.draft), true, 'Checked');
  p.preparePublication();
  assert.throws(() => p.publish({ meetingId: p.state.meeting.id, pages: 11, hash: 'x' }), /receipt/);
  assert.equal(p.state.members[3].generation, 0);
  p.setSession('a', 'accepted-worker-old-session'); p.setSession('d', 'rejected-worker-old-session');
  p.publish({ meetingId: p.state.meeting.id, pages: 2, hash: 'actual-publication-receipt' });
  assert.equal(p.state.members[0].generation, 0); assert.equal(p.state.members[3].generation, 1);
  assert.equal(p.state.members.every(m => m.sessionId === null), true);
  const reopened = new Protocol(join(root, 'state.sqlite')); assert.equal(reopened.state.members[3].rejection.paper.title, 'Paper d'); reopened.close();
});

test('changing the bulletin invalidates every old inspection', t => {
  const { p } = setup(t); define(p); for (const w of roster) p.commit(w.id, commitment); p.decide(); p.draftBulletin(bulletin);
  const hash = digest(p.state.meeting.draft); p.checkBulletin('a', hash, true, 'Checked');
  p.draftBulletin({ ...bulletin, dissent: 'A previously omitted minority objection.' });
  assert.deepEqual(p.state.meeting.checks, {});
  assert.throws(() => p.checkBulletin('b', hash, true, 'Checked'), /Stale/);
});

test('model request budgets persist across a runtime restart', t => {
  const { p, root } = setup(t);
  for (let i = 0; i < 24; i++) p.chargeStep('a', 'worker');
  const reopened = new Protocol(join(root, 'state.sqlite'));
  try { assert.throws(() => reopened.chargeStep('a', 'worker'), /budget exhausted/); }
  finally { reopened.close(); }
  define(p); publish(p);
  for (let i = 0; i < p.state.rules.callsPerInterval; i++) p.chargeStep('a', 'worker');
  assert.throws(() => p.chargeStep('a', 'worker'), /budget exhausted/);
});

test('failed mutations roll back and pausing preserves the submission deadline', t => {
  const { p, advance } = setup(t); define(p); publish(p); p.callMeeting('a', 'Ready');
  const before = p.state.revision, deadline = p.state.meeting.deadline;
  assert.throws(() => p.submit('a', { ...paper('a'), pages: 12 }), /10 pages/);
  assert.equal(p.state.revision, before);
  p.pause(); advance(); p.resume(); assert.equal(p.state.meeting.deadline, deadline + 1000000);
});

test('workspace rejects traversal, dangling symlinks and extra prose documents', t => {
  const { p, root } = setup(t); define(p); publish(p);
  const w = new Workspaces(join(root, 'work'), p, {}), workspace = w.path('a');
  assert.throws(() => w.write('a', '../escape.py', 'x', 'Q1', 'test'), /Only/);
  assert.throws(() => safePath(workspace, '../escape', { write: true }), /escapes/);
  assert.throws(() => safePath(workspace, 'src\\escape.py', { write: true }), /portable/);
  assert.throws(() => safePath(workspace, 'C:escape.py', { write: true }), /portable/);
  try {
    symlinkSync(join(root, 'missing'), join(workspace, 'src', 'link'));
    assert.throws(() => safePath(workspace, 'src/link/file.py', { write: true }), /Symlinks/);
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error.code)) throw error;
    t.diagnostic('Windows runner cannot create a test symlink without developer privileges');
  }
  assert.throws(() => w.write('a', 'src/report.md', 'A new report', 'Q1', 'test'), /Prose/);
});

test('missing sandbox fails closed and never executes experiment code on host', async t => {
  const { p, root } = setup(t); define(p); publish(p);
  const w = new Workspaces(join(root, 'work'), p, { sandboxBackend: 'bubblewrap', bwrap: '/nonexistent/humander-sandbox' });
  w.write('a', 'src/main.py', 'print(1)', 'Q1', 'Implement the baseline.');
  await assert.rejects(w.experiment('a', { command: 'python3 src/main.py', questionId: 'Q1', purpose: 'Measure baseline', stopCondition: 'One execution' }), /ENOENT/);
});

test('Docker sandbox keeps experiment input read-only and denies network', { skip: !process.env.HUMANDER_DOCKER_IMAGE, timeout: 120000 }, async t => {
  const { p, root } = setup(t); define(p); publish(p);
  const w = new Workspaces(join(root, 'work'), p, { sandboxBackend: 'docker', dockerImage: process.env.HUMANDER_DOCKER_IMAGE });
  w.write('a', 'src/main.py', [
    'from pathlib import Path',
    'import socket',
    'try:',
    "    Path('/input/src/main.py').write_text('changed')",
    "    raise RuntimeError('input was writable')",
    'except OSError: pass',
    'try:',
    "    socket.create_connection(('1.1.1.1', 80), timeout=1)",
    "    raise RuntimeError('network was available')",
    'except OSError: pass',
    "Path('/workspace/experiments/result.txt').write_text('isolated')",
  ].join('\n'), 'Q1', 'Check isolated execution.');
  const record = await w.experiment('a', { command: 'python3 /input/src/main.py', questionId: 'Q1', purpose: 'Check isolation', stopCondition: 'One run' });
  assert.equal(record.code, 0, record.output);
  assert.match(record.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.equal(readFileSync(join(root, 'work', 'runs', 'a', record.id, 'output', 'experiments', 'result.txt'), 'utf8'), 'isolated');
  assert.match(readFileSync(join(root, 'work', 'runs', 'a', record.id, 'input', 'src', 'main.py'), 'utf8'), /from pathlib/);
});

test('ACL publication compilation escapes source text and enforces the rendered page limit', { skip: !process.env.HUMANDER_TECTONIC }, async t => {
  const { root } = setup(t);
  const a = new Artifacts(join(root, 'public'), { tectonic: process.env.HUMANDER_TECTONIC, texCache: process.env.HUMANDER_TEX_CACHE }, null);
  const receipt = await a.document(join(root, 'paper'), 'A bounded negative finding', 'No improvement was observed.', { Introduction: 'Test \\input{/etc/passwd} remains literal text.', Method: 'A fixed comparison.', Results: 'No measured benefit.', Limitations: 'One input.' });
  assert.ok(receipt.pages >= 1 && receipt.pages <= 10);
  assert.match(readFileSync(join(root, 'paper/paper.tex'), 'utf8'), /textbackslash/);
});

function submitRound(p) {
  for (const w of p.state.members.filter(m => m.active && !m.suspended)) p.submit(w.id, { ...paper(w.id), artifactHash: digest([p.state.meeting.id,w.id]), contentHash: digest(['content',p.state.meeting.id,w.id]) });
  p.startReview();
}
function reviewRound(p, scores = { a:5,b:4.5,c:4,d:2 }, badModel = null) {
  const s=p.state;
  for(const [author,paper] of Object.entries(s.meeting.submissions))for(const reviewer of p.eligibleReviewers(s,author,paper.authorModel)){
    const r={artifactHash:paper.artifactHash,soundness:4,excitement:3,overall:scores[author]??4,confidence:3,summary:'Evidence-bounded finding.',evidence:'Frozen record location.',limitations:'Small input.',reproducibility:'Actual run retained.',majorCorrectnessObjection:false};
    p.review(reviewer.id,author,r);
    p.recordAudit(reviewer.id,author,r,[{field:'code',expected:reviewer.model===badModel?99:0,observed:0,outcome:reviewer.model===badModel?'contradicted':'supported',verifier:'test-host'}]);
  }
  p.releaseReviews();
}
function prepare(p) {
  for(const w of p.participants(p.state))p.commit(w,commitment);
  p.decide();
}
function finishPublication(p) {
  p.draftBulletin(bulletin);
  for(const w of p.participants(p.state))p.checkBulletin(w,digest(p.state.meeting.draft),true,'Attribution checked; disagreements preserved.');
  p.preparePublication();p.publish({meetingId:p.state.meeting.id,pages:3,hash:'verified-publication'});
}

test('amendments require a meeting, fresh worker discussion and human ratification; old criteria remain frozen',t=>{
  const {p}=setup(t);define(p);publish(p);
  p.requestAmendment('Use a broader fixed input and retain exactness.',{acceptanceRate:0.75});
  assert.equal(p.state.phase,'SUBMISSION');
  assert.equal(p.state.definition.version,1);
  submitRound(p);reviewRound(p);p.beginAmendment();
  assert.throws(()=>p.draftDefinition(definition),/All workers/);
  for(const w of roster)p.statement(w.id,'Discuss the changed evaluation input.');
  p.draftDefinition({...definition,scope:'Broader fixed input'});
  const hash=digest(p.state.definitionDraft);
  assert.throws(()=>p.ratify(hash),/Every worker/);
  for(const w of roster)p.checkDefinition(w.id,hash,'Checked revised scope.');p.ratify(hash);
  assert.equal(p.state.definition.version,2);
  assert.equal(p.state.meeting.definitionSnapshot.scope,definition.scope);
  assert.equal(p.state.meeting.rulesSnapshot.acceptanceRate,0.5);
  assert.equal(p.state.rules.acceptanceRate,0.75);
  prepare(p);finishPublication(p);
  assert.equal(p.state.publications.at(-1).definitionVersion,1);
  assert.equal(p.state.publications.at(-1).nextDefinitionVersion,2);
});

test('unavailable inspectors require explicit exclusion; exclusion is preserved and does not invent approval',t=>{
  const {p}=setup(t);define(p);prepare(p);p.draftBulletin(bulletin);
  for(const w of roster.slice(0,3))p.checkBulletin(w.id,digest(p.state.meeting.draft),true,'Checked');
  assert.throws(()=>p.preparePublication(),/All workers/);
  p.exclude('d','Provider unavailable after retries.');
  assert.equal(p.state.phase,'BULLETIN');
  finishPublication(p);
  assert.equal(p.state.publications[0].checks.d,undefined);
  assert.match(p.state.publications[0].excluded.d.reason,/unavailable/);
  assert.equal(p.state.members[3].suspended,true);
  p.reinstate('d','Provider recovered.');
  assert.ok(p.participants(p.state).includes('d'));
});

test('pending papers persist across meetings; independent appeal reviews retain original capacity and reset after publication',t=>{
  const {p}=setup(t);define(p);publish(p);p.callMeeting('a','Results ready');submitRound(p);reviewRound(p,{a:5,b:4,c:4,d:2});prepare(p);finishPublication(p);
  const old=p.state.publications.at(-1),b=p.state.cases.find(c=>c.author==='b'),c=p.state.cases.find(c=>c.author==='c');
  assert.ok(b&&c);assert.equal(p.state.members[1].generation,0);
  assert.throws(()=>p.fileAppeal('c',old.id,'Tie needs examination.',['Frozen evidence']),/requires/);
  p.callMeeting('c','Appeal and new work are ready');
  p.fileAppeal('c',old.id,'Original evidence distinguishes the contribution.',['Original frozen experiment']);
  assert.throws(()=>p.fileAppeal('c',old.id,'Repeat',['Evidence']),/One appeal/);
  submitRound(p);reviewRound(p);
  for(const item of p.state.cases)for(const r of p.eligibleReviewers(p.state,item.author,item.authorModel))p.caseReview(r.id,item.id,{artifactHash:item.paper.artifactHash,soundness:4,excitement:3,overall:4.5,confidence:3,summary:'Reexamined original version.',evidence:'Frozen evidence.',limitations:'Original scope.',reproducibility:'Checked.',majorCorrectnessObjection:false});
  prepare(p);
  p.resolveCase(c.id,'accepted','Evidence resolves the original tie.','Original frozen claim C1.');
  assert.throws(()=>p.resolveCase(b.id,'accepted','Also accept.','C1'),/capacity/);
  p.resolveCase(b.id,'rejected','Original batch capacity is exhausted.','Two places; a and c accepted.');
  assert.equal(p.state.cases.find(x=>x.id===b.id).status,'open');
  finishPublication(p);
  assert.equal(p.state.cases.find(x=>x.id===c.id).resolution.outcome,'accepted');
  assert.equal(p.state.publications[1].decisions.c.outcome,'pending','Historical bulletin is immutable');
  assert.equal(p.state.members[1].generation,1,'Deferred rejection resets the original generation at publication');
});

test('factual audit turnover accumulates across cohorts, survives author resets, permits challenge and uses only the eligible pool',t=>{
  const {p,root}=setup(t);define(p);publish(p);p.setPool([{provider:'test',model:'model-e'}]);
  for(let n=0;n<2;n++){
    p.callMeeting('a','Executed evidence is ready');submitRound(p);reviewRound(p,undefined,'model-d');prepare(p);
    if(n===0){assert.equal(p.state.meeting.retirements.length,0);finishPublication(p);}
  }
  assert.equal(p.state.meeting.retirements[0].model,'model-d');
  const audit=p.state.audits.find(a=>a.model==='model-d');
  p.draftBulletin(bulletin);p.contestAudit('d',audit.id,'Check the exact record version.','Frozen record hash');
  assert.equal(p.state.meeting.retirements.length,0);assert.equal(p.state.phase,'BULLETIN');
  p.adjudicateAudit(audit.id,true,'The frozen record contradicts the claim.','Recorded exit code 0, claimed 99.');
  assert.equal(p.state.members[3].model,'model-d','Retirement waits for checked publication');
  finishPublication(p);
  assert.equal(p.state.members[3].model,'model-e');assert.ok(p.state.retiredModels.includes('model-d'));
  assert.equal(p.reviewerStats().find(x=>x.model==='model-d').errorReviews,6);
  assert.throws(()=>p.setPool([{provider:'test',model:'model-d'}]),/non-retired/);
  const reopened=new Protocol(join(root,'state.sqlite'));assert.ok(reopened.state.retiredModels.includes('model-d'));reopened.close();
});

test('retraction remains linked to the original publication and completion distinguishes adoption from infeasibility',t=>{
  const {p}=setup(t);define(p);publish(p);p.callMeeting('a','Ready');submitRound(p);reviewRound(p);prepare(p);finishPublication(p);
  const accepted=p.state.publications.at(-1).submissions.a;
  assert.throws(()=>p.complete('accepted','Looks good'),/recorded pass/);
  p.callMeeting('b','A defect and further work are ready');p.fileCorrection('b',accepted.artifactHash,'The old claim fails an explicit condition.',['Frozen record and counterexample']);
  submitRound(p);reviewRound(p);prepare(p);
  const c=p.state.cases.find(c=>c.kind==='correction');p.resolveCase(c.id,'retracted','Independent evidence establishes a material defect.','Counterexample under the original criterion.');finishPublication(p);
  assert.equal(p.paperDecision(p.state,accepted.artifactHash).outcome,'retracted');
  p.complete('infeasible','The defined target was shown infeasible; no deliverable is adopted.');
  assert.equal(p.state.phase,'COMPLETE');assert.equal(p.state.completion.outcome,'infeasible');
});

test('human budget extension and deadline recovery are explicit and do not erase model history',t=>{
  const {p,advance}=setup(t);define(p);publish(p);p.callMeeting('a','Ready');
  const deadline=p.state.meeting.deadline;advance();p.extendWindow(60000,'Provider outage delayed packaging.');assert.ok(p.state.meeting.deadline>deadline);
  const budget=p.state.rules.maxProjectCalls;p.grantCalls(100,'Additional calls to finish the meeting.');assert.equal(p.state.rules.maxProjectCalls,budget+100);
  assert.equal(p.state.humanRecords.at(-1).action,'budget_extension');
  for(let i=0;i<24;i++)p.chargeStep('a','worker');assert.throws(()=>p.chargeStep('a','worker'),/budget/);p.retry('a','Retry after the provider recovered.');p.chargeStep('a','worker');
});

test('initial route repair and explicit worker replacement preserve independent models and the publication barrier',t=>{
  const {p}=setup(t);p.repairRoute('d','test','model-d-corrected','Correct a provider model identifier.');
  assert.equal(p.state.members[3].model,'model-d-corrected');define(p);publish(p);
  assert.throws(()=>p.repairRoute('d','test','model-other','Change'),/requires/);
  p.setPool([{provider:'test',model:'model-new'}]);p.callMeeting('a','Ready');
  p.queueReplacement('d','model-new','Current provider cannot support the planned experiments.');
  submitRound(p);reviewRound(p);prepare(p);
  assert.equal(p.state.members[3].model,'model-d-corrected');finishPublication(p);
  assert.equal(p.state.members[3].model,'model-new');
  assert.ok(p.state.members[3].history.some(h=>h.model==='model-d-corrected'));
});

test('gateway embeds panel without exposing its credential and requires same-origin JSON mutations', async t => {
  const root = mkdtempSync(join(tmpdir(), 'humander-gateway-'));
  const actions = [];
  const runtime = { protocol: { state: null }, status: () => ({ project: null }), humanAction: async input => actions.push(input) };
  const panel = await startPanel(runtime, { stateDir: root, port: 0 });
  const gateway = createServer((req, res) => {
    if (req.headers.cookie !== 'test-session=valid') { res.writeHead(401); res.end(); return; }
    forwardPanel(req, res, { mount: '/dsh/humander', port: panel.port, tokenPath: panel.tokenPath, secure: false });
  });
  await new Promise(resolve => gateway.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => gateway.close(resolve)); await panel.close(); rmSync(root, { recursive: true, force: true }); });
  const origin = `http://127.0.0.1:${gateway.address().port}`;
  const base = origin + '/dsh/humander/';
  const headers = { cookie: 'test-session=valid' };
  assert.equal((await fetch(base + 'api/state')).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${panel.port}/api/state`)).status, 401);
  const page = await fetch(base, { headers }); const html = await page.text();
  assert.equal(page.status, 200); assert.ok(html.includes('name="humander-gateway"'));
  assert.ok(!html.includes(readFileSync(panel.tokenPath, 'utf8')));
  assert.equal(page.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'self'/);
  assert.deepEqual(await (await fetch(base + 'api/state', { headers })).json(), { project: null });
  const post = extra => fetch(base + 'api/action', { method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extra }, body: '{"action":"step"}' });
  assert.equal((await post({})).status, 403);
  assert.equal((await post({ origin: 'https://foreign.invalid' })).status, 403);
  assert.equal((await post({ origin, 'content-type': 'text/plain' })).status, 403);
  assert.equal(actions.length, 0);
  assert.equal((await post({ origin })).status, 200); assert.equal(actions.length, 1);
});

test('native sidebar activates without host config and resolves the app mount', async () => {
  const { runInNewContext } = await import('node:vm');
  for (const pathname of ['/dsh', '/dsh/', '/']) {
    let entry;
    runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
      window: { __ModuleLoader__: { load: e => { entry = e; } } }, location: { pathname },
    });
    const plugin = entry.factory(() => ({ createElement: (type, props) => ({ type, props }), useEffect: () => {}, useState: () => ['ready', () => {}] }));
    const registrations = [];
    plugin.apply({ effect: fn => [...fn()], slots: { inject: (_, fn) => fn(), register: (options, component) => registrations.push({ options, component }) } });
    const main = registrations.find(r => r.options.name === 'main');
    assert.equal(main.component().props.src, pathname === '/' ? '/humander/' : '/dsh/humander/');
    assert.equal(registrations.find(r => r.options.name === 'sidebar.panellist').options.id, main.options.key);
  }
});

test('sidebar explains a missing gateway instead of showing an empty panel', async () => {
  const { runInNewContext } = await import('node:vm');
  let entry, route = 'checking', probe;
  runInNewContext(readFileSync(new URL('../src/client.js', import.meta.url), 'utf8'), {
    window: { __ModuleLoader__: { load: e => { entry = e; } } },
    location: { pathname: '/dsh/' }, navigator: { language: 'zh-CN' },
    fetch: async () => ({ ok: true, headers: { get: () => 'text/html' }, text: async () => '<html>DSH</html>' }),
  });
  const plugin = entry.factory(() => ({
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
    useEffect: callback => { probe = callback; }, useState: () => [route, next => { route = next; }],
  }));
  const registrations = [];
  plugin.apply({ effect: fn => [...fn()], slots: { inject: (_, fn) => fn(), register: (options, component) => registrations.push({ options, component }) } });
  const Panel = registrations.find(r => r.options.name === 'main').component;
  assert.equal(Panel().type, 'div');
  probe(); await new Promise(resolve => setImmediate(resolve));
  const fallback = Panel();
  assert.equal(fallback.type, 'div');
  assert.match(JSON.stringify(fallback), /Humander 面板尚未启动/);
  assert.match(JSON.stringify(fallback), /http:\/\/127\.0\.0\.1:3088\//);
});

test('saved team survives restart, validates review diversity and keeps the secretary outside the worker count', t => {
  const root=mkdtempSync(join(tmpdir(),'humander-team-')),path=join(root,'state.sqlite');
  let p=new Protocol(path);t.after(()=>{p.close();rmSync(root,{recursive:true,force:true});});
  const configuration={request:'',members:roster.slice(0,2),settings:{minReviews:1},secretary:{provider:'another-provider',model:'secretary-only'}};
  p.saveConfiguration(configuration);assert.equal(p.state,null);
  p.close();p=new Protocol(path);assert.equal(p.configuration.secretary.model,'secretary-only');assert.equal(p.configuration.members.length,2);
  assert.throws(()=>p.saveConfiguration({...configuration,settings:{minReviews:2}}),/enough non-author/);
  assert.throws(()=>p.saveConfiguration({...configuration,members:roster.slice(0,2).map(m=>({...m,model:'same'}))}),/distinct model/);
  assert.equal(p.configuration.members[0].model,'model-a');
  p.open('Study exact summation.',p.configuration.members,p.configuration.settings,p.configuration.secretary);
  assert.equal(p.state.members.length,2);assert.equal(p.state.secretaryConfig.model,'secretary-only');
  assert.throws(()=>p.saveConfiguration(configuration),/already exists/);
});

test('initial team resize invalidates stale requirements; independent secretary changes preserve human control', t=>{
  const {p}=setup(t);
  for(const w of roster)p.statement(w.id,'Initial discussion.');p.draftDefinition(definition);
  const oldHash=digest(p.state.definitionDraft);
  p.configureTeam(roster.slice(0,2),{minReviews:1},{provider:'test',model:'secretary-only'},'Use two workers for this problem.');
  assert.deepEqual(p.state.meeting.roster,['a','b']);assert.equal(p.state.definitionDraft,null);assert.equal(p.state.definitionRound,1);
  assert.throws(()=>p.draftDefinition(definition),/All workers/);
  assert.throws(()=>p.ratify(oldHash));
  for(const w of roster.slice(0,2))p.statement(w.id,'New team discussion.');p.draftDefinition(definition);
  for(const w of roster.slice(0,2))p.checkDefinition(w.id,digest(p.state.definitionDraft),'Checked the new team definition.');
  p.ratify(digest(p.state.definitionDraft));
  assert.throws(()=>p.configureTeam(roster,{},undefined,'Change after ratification'));
  p.setSession('secretary','old-secretary');p.setSecretary(null,'Use a separate summarization model.',{provider:'different',model:'another-secretary'});
  assert.deepEqual(p.state.secretaryConfig,{provider:'different',model:'another-secretary'});assert.equal(p.state.secretarySessionId,null);
  assert.equal(p.state.members.length,2);assert.equal(p.state.humanRecords.at(-1).provider,'different');
  p.change('human','test.retire',s=>{s.retiredModels.push('retired');});
  assert.throws(()=>p.setSecretary(null,'Retired model',{provider:'test',model:'retired'}),/non-retired/);
});


test('project language persists and changing it before ratification invalidates old requirement discussions', t => {
  const root=mkdtempSync(join(tmpdir(),'humander-language-')),p=new Protocol(join(root,'state.sqlite'));
  t.after(()=>{p.close();rmSync(root,{recursive:true,force:true});});
  assert.throws(()=>p.open('需求',roster,{},undefined,'fr'),/Language must/);
  p.saveConfiguration({request:'研究精确求和',members:roster,secretary:roster[0],language:'zh'});
  assert.equal(p.configuration.language,'zh');
  p.open('研究精确求和',roster,{},roster[0],p.configuration.language);
  assert.equal(p.state.language,'zh');
  p.statement('a','讨论需求。');
  p.configureTeam(roster,{},roster[0],'用户将写作语言改为英文。','en');
  assert.equal(p.state.language,'en');assert.equal(p.state.definitionRound,1);
  assert.equal(p.state.humanRecords.at(-1).previousLanguage,'zh');
  assert.equal(p.state.humanRecords.at(-1).nextLanguage,'en');
  assert.equal(p.state.meeting.statements[0].round,0);
  assert.throws(()=>p.draftDefinition(definition),/All workers must discuss/);
  for(const w of roster)p.statement(w.id,'Discuss the request again.');
  p.draftDefinition(definition);assert.equal(p.state.definitionDraft.language,'en');
  for(const w of roster)p.checkDefinition(w.id,digest(p.state.definitionDraft),'Checked.');
  p.ratify(digest(p.state.definitionDraft));
  assert.throws(()=>p.configureTeam(roster,{},roster[0],'Too late.','zh'),/DEFINITION phase|only before/);
  assert.equal(p.state.language,'en');
});

test('offline ACL PDF preserves Chinese titles, sections and original text as selectable Unicode', {skip:!process.env.HUMANDER_TECTONIC}, async t => {
  const root=mkdtempSync(join(tmpdir(),'humander-zh-pdf-'));
  t.after(()=>rmSync(root,{recursive:true,force:true}));
  const a=new Artifacts(join(root,'public'),{tectonic:process.env.HUMANDER_TECTONIC,texCache:process.env.HUMANDER_TEX_CACHE},null);
  const dir=join(root,'paper');const receipt=await a.document(dir,'有价值的失败','实验未发现改进。',{introduction:'原始中文需求：保持精确求和。',method:'输入与代码均保留。',results:'结果包含字符 & 与下划线 _，仍可阅读。'},undefined,'zh');
  assert.ok(receipt.pages>=1&&receipt.pages<=10);
  const extracted=execFileSync('pdftotext',[join(dir,'paper.pdf'),'-'],{encoding:'utf8'});
  for(const phrase of ['有价值的失败','摘要','原始中文需求','保持精确求和','结果'])assert.ok(extracted.includes(phrase),phrase);
  assert.match(readFileSync(join(dir,'paper.tex'),'utf8'),/humandercjk/);
});
