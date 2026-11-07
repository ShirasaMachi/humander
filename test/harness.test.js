import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, symlinkSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { once } from 'node:events';
const require = createRequire(import.meta.url);
const fixtureSource = String.raw`import { LlmAdapter } from 'LLM_MODULE_URL';
import { randomUUID } from 'node:crypto';
export const name = 'humander-test-provider';
export const inject = ['llm'];
const runs = new Map();
const written = new Set();
const reproduced = new Set();
const interval = new Map();
const definition = { interpretation:'Compare exact integer summation methods.', scope:'A fixed small integer input.', acceptance:'Equal exact sum; report operation count without claiming general speedups.', stopping:'Two research meetings or exhausted budget.', provenance:'Human-stated: exact summation. Worker-proposed: operation counts.', acceptanceChecks:[{id:'A1',questionId:'Q1',outcome:'Exact sum',evaluation:'Fixed input',method:'Execute comparison',checker:'human',pass:'Exact equality',failure:'Record bounded negative evidence'}],questions:[{id:'Q1',text:'Does this attempted method preserve exactness with less work?'}] };
const commitment = {questionId:'Q1',investigation:'Compare exact summation methods.',expectedObservation:'Exact sum and operation count.',budget:'One executed experiment.',stopping:'A fixed input completes.',priorFailures:'Inspect the prior bulletin and cite relevant failures.'};
class Fixture extends LlmAdapter {
 async listModels(provider) { return ['a','b','c','d','s','t'].map(id=>({provider,id:'fixture-'+id,name:'Fixture '+id})); }
 async *stream(options) {
  const names=options.tools?.map(t=>t.name)??[];
  if(names.some(n=>!n.startsWith('humander_'))) throw Error('Non-humander tool leaked: '+names.join(','));
  let actor=options.model.slice(-1);
  const last=options.messages.at(-1);
  let value;try{value=JSON.parse(last?.content?.filter(c=>c.type==='text').map(c=>c.text).join(''));}catch{}
  if(last?.isError) console.error('Fixture tool failure',JSON.stringify(last).slice(-800));
  if(value?.worker && value?.sourceHash) runs.set(value.worker+':'+value.generation+':'+interval.get(value.worker),value.id);
  let name='humander_state', args={};
  if(value?.phase){
    const s=value;
    actor=s.members.find(m=>m.model===options.model)?.id??actor;
    if(names.includes('humander_draft_definition')) {
      if(!['fixture-s','fixture-t'].includes(options.model)) throw Error('Secretary did not use its separately configured model');
      if(['DEFINITION','AMENDMENT'].includes(s.phase)){name='humander_draft_definition';args={draft:{...definition,scope:s.phase==='AMENDMENT'?'Expanded fixed input under human-confirmed conditions.':definition.scope}};}
      else {name='humander_draft_bulletin';args={draft:{summary:'A bounded comparison, including a useful failed attempt.',progress:'Q1 was investigated using executed code where applicable.',consensus:'Preserve exactness and inspect the frozen experimental records.',dissent:'A failed attempt does not establish universal infeasibility.',humanDecisions:'None; continue within the ratified budget.'}};}
    } else if(names.includes('humander_review')) {
      const author=s.assignedAuthor;
      const key=actor+':'+author+':'+s.meeting.number+':'+(s.assignedCase??'current');
      if(!reproduced.has(key)){name='humander_reproduce';args={runId:s.meeting.submissions[author].experiments[0],reason:'Does the frozen input reproduce the recorded exit code and output?'};reproduced.add(key);}
      else{name='humander_review';args={update:s.phase==='DISCUSSION',review:{artifactHash:s.meeting.submissions[author].artifactHash,soundness:4,excitement:3,overall:{a:5,b:4.5,c:4,d:2}[author],confidence:3,summary:'A deterministic integration-test assessment, not scientific validation.',evidence:'The frozen experiment was independently rerun.',limitations:'One small input.',reproducibility:'The run command and output are retained.',majorCorrectnessObjection:false,claims:[{runId:s.meeting.submissions[author].experiments[0],field:'code',expected:options.model==='fixture-d'&&s.meeting.number>=2?99:author==='b'?1:0}]}};}
    } else if(['DEFINITION','AMENDMENT'].includes(s.phase)){
      if(!s.definitionDraft){name='humander_statement';args={body:'Clarify exactness, a fixed input and an explicit stopping criterion.'};}
      else{name='humander_check_definition';args={hash:s.definitionDraftHash,note:'The draft preserves the original request and labels proposals.'};}
    } else if(s.phase==='RESEARCH'){
      const key=actor+':'+s.members.find(m=>m.id===actor).generation+':'+s.meeting.number;interval.set(actor,s.meeting.number);
      if(!written.has(key)){name='humander_write';args={path:'src/main.py',content:'# Frozen interval '+s.meeting.number+'\n'+(actor==='b'?'print("failed optimization: no improvement")\nraise SystemExit(1)\n':'print(sum([1,2,3]))\n'),questionId:'Q1',reason:'One bounded experiment for the current research interval.'};written.add(key);}
      else if(!runs.has(key)){name='humander_experiment';args={experiment:{command:'python3 src/main.py',questionId:'Q1',purpose:'Observe a bounded attempt in interval '+s.meeting.number,stopCondition:'One execution.',worker:'forged',sourceHash:'forged',generation:99}};}
      else {
        if(!written.has('ready-'+key)){written.add('ready-'+key);yield {type:'block-start',index:0,blockType:'text'};yield {type:'block-end',index:0,block:{type:'text',text:'Experiment complete.'}};yield {type:'finish',reason:{kind:'stop'}};return;}
        name='humander_call_meeting';args={reason:'My executed experiment is ready for collective examination.'};
      }
    } else if(s.phase==='SUBMISSION'){
      name='humander_submit';args={paper:{title:'Worker '+actor+' bounded experiment '+s.meeting.number,contribution:actor==='b'?'An executed failed optimization provides a useful negative result.':'An exact baseline with bounded evidence.',questionIds:['Q1'],license:'MIT',experiments:[runs.get(actor+':'+s.members.find(m=>m.id===actor).generation+':'+(s.meeting.number-1))],sections:{abstract:'A bounded experimental observation.',introduction:'Investigate Q1 under the ratified scope.',relatedWork:'The project problem definition establishes the comparison.',method:'Run python3 src/main.py on the frozen input.',results:actor==='b'?'The attempted optimization failed with exit status 1.':'The baseline prints 6.',discussion:'Interpret the actual exit status and output conservatively.',limitations:'One input and one execution; no general performance claim.',references:'The human-ratified Problem Definition Paper.'}}};
    } else if(s.phase==='DISCUSSION'){
      if(s.meeting.submissions[actor]&&!s.meeting.responses[actor]){name='humander_respond';args={body:'The experimental claim is deliberately bounded; inspect the retained record.'};}
      else if(actor==='a'&&s.meeting.number>0&&!s.acceptanceResults.some(r=>r.actor===actor&&r.meetingId===s.meeting.id&&r.definitionVersion===s.definition.version)){name='humander_acceptance_result';args={result:{checkId:'A1',outcome:'pass',evidence:s.meeting.submissions[actor].artifactHash,reason:'The frozen execution prints the exact sum 6.'}};}
      else{name='humander_commit';args={commitment,failures:actor==='b'&&s.meeting.number>0?[{attempt:'Optimization',conditions:'Fixed input',observation:'Execution exited with status 1.',uncertainty:'No universal impossibility claim.',implication:'Do not repeat unchanged.',evidence:s.meeting.submissions[actor].artifactHash}]:[]};}
    } else if(s.phase==='INSPECTION'){name='humander_check_bulletin';args={hash:s.bulletinDraftHash,approved:true,note:'Checked attribution, failure scope and the distinction between acceptance and truth.'};}
  }
  const callId=randomUUID();
  yield {type:'block-start',index:0,blockType:'tool-call'};
  yield {type:'tool-call-delta',index:0,id:callId,name,argumentsDelta:JSON.stringify(args)};
  yield {type:'block-end',index:0,block:{type:'tool-call',id:callId,name,arguments:JSON.stringify(args)}};
  yield {type:'finish',reason:{kind:'tool-calls'}};
 }
}
export function apply(ctx){ctx.llm.registerAdapter(['humander-fixture'],new Fixture());}
`;

async function freePort() {
  const s = createServer(); s.listen(0, '127.0.0.1'); await once(s, 'listening');
  const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port;
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

test('real Harness: three research meetings, amendment, factual audits, replacement, historical review, restart and adoption', { skip: !process.env.HUMANDER_DSH_BIN || !process.env.HUMANDER_TECTONIC, timeout: 180000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), 'humander-harness-'));
  const dshHome = join(root, 'dsh-home'), stateDir = join(dshHome, 'humander-state'), profile = join(dshHome, 'profiles', 'humander');
  const port = await freePort(), webPort = await freePort();
  const project = fileURLToPath(new URL('../', import.meta.url));
  mkdirSync(join(profile, 'node_modules'), { recursive: true });
  symlinkSync(project, join(profile, 'node_modules', 'dsh-humander'));
  writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'humander-integration-profile', private: true, dependencies: { 'dsh-humander': `link:${project}` }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-humander'] } } }));
  const fixtureFile = join(root, 'fixture.mjs');
  writeFileSync(fixtureFile, fixtureSource.replace('LLM_MODULE_URL', pathToFileURL(require.resolve('@deepseek-ai/dsh-llm')).href));
  const patch = [{ id: 'humander', config: { port, autoRun: false, publicBaseUrl: `http://127.0.0.1:${webPort}`, tectonic: process.env.HUMANDER_TECTONIC, texCache: process.env.HUMANDER_TEX_CACHE || '', bwrap: '/usr/bin/bwrap' } }, { insert: [{ id: 'humander-fixture', name: fixtureFile }] }];
  writeFileSync(join(profile, 'cordis.patch.yml'), JSON.stringify(patch));
  let child = spawn(process.env.HUMANDER_DSH_BIN, ['--profile', 'humander', '--no-open', '--host', '127.0.0.1', '--port', String(webPort)], { cwd: project, env: { ...process.env, DSH_HOME: dshHome }, stdio: ['ignore', 'pipe', 'pipe'] });
  let logs = ''; child.stdout.on('data', b => { logs += b; }); child.stderr.on('data', b => { logs += b; });
  t.after(async () => { if(child.exitCode === null){ const exited = once(child,'exit'); child.kill('SIGINT'); await Promise.race([exited,delay(5000)]); if(child.exitCode === null)child.kill('SIGKILL'); } rmSync(root, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${port}`;
  let ready = false;
  for(let n=0;n<150;n++){try{if((await fetch(base)).ok){ready=true;break;}}catch{} if(child.exitCode!==null)break; await delay(100);}
  assert.ok(ready, 'Harness startup failed: '+logs.replace(/token=[^\s]+/g,'token=[redacted]').slice(-3000));
  const webBase = `http://127.0.0.1:${webPort}`;
  let routeStatus;
  for (let n = 0; n < 50; n++) {
    routeStatus = (await fetch(webBase + '/humander/')).status;
    if (routeStatus !== 404) break;
    await delay(100);
  }
  assert.equal(routeStatus, 401, 'The panel route requires DSH authentication: ' + logs.replace(/token=[^\s]+/g, 'token=[redacted]').slice(-1500));
  const launchUrl = logs.match(/dsh web: (\S+)/)?.[1];
  assert.ok(launchUrl, 'DSH did not announce its login URL');
  const login = await fetch(launchUrl, { redirect: 'manual' });
  const cookie = login.headers.get('set-cookie')?.split(';')[0];
  assert.ok(cookie, 'DSH did not issue a browser session');
  const embedded = await fetch(webBase + '/humander/', { headers: { cookie } });
  assert.equal(embedded.status, 200);
  assert.match(await embedded.text(), /name="humander-gateway"/);
  const token = readFileSync(join(stateDir,'operator.token'),'utf8').trim();
  async function api(path,body){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined}); const out=await r.json(); assert.equal(r.status,200,JSON.stringify(out));return out;}
  assert.equal((await fetch(base+'/api/state')).status,401);
  assert.equal((await fetch(base+'/api/models')).status,401);
  const catalog=await api('/api/models?provider=humander-fixture');
  assert.ok(catalog.models.some(m=>m.id==='fixture-s'));
  assert.ok((await api('/api/models')).providers.some(p=>p.id==='humander-fixture'));
  const configuration={request:'Compare exact integer summation methods using executed code and experiments.',members:['a','b','c','d'].map(id=>({id,provider:'humander-fixture',model:'fixture-'+id})),secretary:{provider:'humander-fixture',model:'fixture-s'}};
  await api('/api/action',{action:'save_configuration',...configuration});
  assert.equal((await api('/api/state')).project,null,'Saving configuration does not open a project');
  assert.equal((await api('/api/state')).configuration.secretary.model,'fixture-s');
  await api('/api/action',{action:'open',...configuration});
  await api('/api/action',{action:'configure_team',...configuration,reason:'Confirm the editable initial roster.'});
  await api('/api/action',{action:'step'});
  for(let i=0;i<600;i++){await delay(100);if(!(await api('/api/state')).running)break;}
  assert.ok((await api('/api/state')).project.secretarySessionId,'Explicit secretary model created its own session');
  const oldSecretary=(await api('/api/state')).project.secretarySessionId;
  await api('/api/action',{action:'secretary',secretary:{provider:'humander-fixture',model:'fixture-t'},reason:'Switch the independent secretary model.'});
  assert.equal((await api('/api/state')).project.secretarySessionId,null);
  assert.ok(!(await api('/api/state')).sessions.some(s=>s.id===oldSecretary),'Previous secretary context disposed');
  let final;
  for(let n=0;n<30;n++){
    let s=await api('/api/state');
    if(s.project.phase==='RESEARCH'&&s.project.meeting.number===1){final=s;break;}
    if(s.project.phase==='DEFINITION'&&Object.keys(s.project.definitionChecks).length===4)await api('/api/action',{action:'ratify',hash:s.definitionDraftHash});
    else await api('/api/action',{action:'step'});
    for(let i=0;i<600;i++){await delay(100);s=await api('/api/state');if(!s.running)break;}
    assert.equal(s.running,false,'Phase did not finish'); assert.equal(s.lastError,null,JSON.stringify({error:s.lastError,phase:s.project.phase,meeting:s.project.meeting.number,logs:logs.slice(-3500)}));
  }
  assert.ok(final,'Research meeting did not complete');
  assert.equal(Object.keys(final.project.meeting.submissions).length,4);
  assert.equal(Object.keys(final.project.meeting.reviews).length,12);
  assert.equal(final.project.meeting.decisions.b.outcome,'accepted','Useful failure can be selected');
  assert.deepEqual(final.project.members.map(m=>m.generation),[1,1,2,2]);
  assert.equal(final.project.publications.length,2);
  for(const p of final.project.publications)assert.ok(p.publication.pages>=1&&p.publication.pages<=10);
  const b=final.project.meeting.submissions.b;
  const run=JSON.parse(readFileSync(join(stateDir,'work/runs/b',b.experiments[0]+'.json'),'utf8'));
  assert.equal(run.code,1,'The negative experiment really failed');
  assert.equal(run.worker,'b','Model input cannot overwrite recorded provenance');
  assert.equal(run.generation,1);
  assert.notEqual(run.sourceHash,'forged');
  assert.match(run.output,/failed optimization/);
  const record=JSON.parse(readFileSync(join(stateDir,'public',final.project.publications.at(-1).publication.path.replace('paper.pdf','record.json')),'utf8'));
  assert.equal(record.reproductions.length,12,'Each reviewer reran the frozen experiment');
  assert.ok(record.reproductions.every(r=>r.exactMatch));
  assert.ok((await fetch(b.releaseUrl+'/manifest.json')).ok);
  assert.equal((await fetch(base+'/api/document?path='+encodeURIComponent(final.project.publications.at(-1).publication.path),{headers:{Authorization:'Bearer '+token}})).status,200);
  async function stepUntil(predicate,max=35){
    for(let n=0;n<max;n++){
      let s=await api('/api/state');if(predicate(s))return s;
      if(['DEFINITION','AMENDMENT'].includes(s.project.phase)&&Object.keys(s.project.definitionChecks).length===s.project.meeting.roster.filter(w=>!s.project.meeting.excluded[w]).length&&s.definitionDraftHash)await api('/api/action',{action:'ratify',hash:s.definitionDraftHash});
      else await api('/api/action',{action:'step'});
      for(let i=0;i<600;i++){await delay(100);s=await api('/api/state');if(!s.running)break;}
      assert.equal(s.running,false);assert.equal(s.lastError,null,JSON.stringify({error:s.lastError,phase:s.project.phase,meeting:s.project.meeting.number,logs:logs.slice(-5000)}));
    }assert.fail('Scenario did not reach its target phase');
  }
  await api('/api/action',{action:'pool',pool:[{provider:'humander-fixture',model:'fixture-e'}]});
  await api('/api/action',{action:'step'});
  for(let i=0;i<600;i++){await delay(100);if(!(await api('/api/state')).running)break;}
  await api('/api/action',{action:'amend',body:'Expand the fixed evaluation input; retain exactness.',settings:{maxMeetings:4}});
  const second=await stepUntil(s=>s.project.phase==='RESEARCH'&&s.project.meeting.number===2);
  assert.equal(second.project.definition.version,2);
  assert.equal(second.project.publications.at(-1).definitionVersion,1);
  assert.equal(second.project.members.find(m=>m.id==='d').model,'fixture-e','Verified factual errors replace the model seat after publication');
  assert.ok(second.project.retiredModels.includes('fixture-d'));
  assert.equal(second.project.cases.filter(c=>c.status==='open').length,3,'Papers lacking reliable independent reviews remain pending');
  const stopped=once(child,'exit');child.kill('SIGINT');await stopped;
  child=spawn(process.env.HUMANDER_DSH_BIN,['--profile','humander','--no-open','--host','127.0.0.1','--port',String(webPort)],{cwd:project,env:{...process.env,DSH_HOME:dshHome},stdio:['ignore','pipe','pipe']});
  child.stdout.on('data',b=>{logs+=b;});child.stderr.on('data',b=>{logs+=b;});
  for(let i=0;i<150;i++){try{if((await fetch(base)).ok)break;}catch{}await delay(100);}
  assert.equal((await api('/api/state')).project.definition.version,2,'Restart preserves the ratified amendment');
  const third=await stepUntil(s=>s.project.phase==='RESEARCH'&&s.project.meeting.number===3);
  assert.equal(Object.keys(third.project.meeting.submissions).length,4,'Case review never waives mandatory new submissions');
  assert.ok(third.project.cases.every(c=>c.status==='resolved'));
  assert.equal(third.project.cases.filter(c=>c.resolution.outcome==='accepted').length,2);
  assert.ok(third.project.cases.every(c=>c.definition.version===1),'Historical cases retain original criteria');
  await api('/api/action',{action:'complete',outcome:'accepted',reason:'The current acceptance check has a published, inspectable passing result.'});
  assert.equal((await api('/api/state')).project.phase,'COMPLETE');
});
