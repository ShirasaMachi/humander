import { DatabaseSync } from 'node:sqlite';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function requireThat(condition, message) {
  if (!condition) throw new Error(message);
}
export function text(value, name, max = 24000) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${name} must be nonempty text (max ${max})`);
  return value.trim();
}
export const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const median = xs => { const a = [...xs].sort((x, y) => x - y); return (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2; };
const id = () => randomUUID();
const phases = ['DEFINITION', 'AMENDMENT', 'RESEARCH', 'SUBMISSION', 'REVIEW', 'DISCUSSION', 'BULLETIN', 'INSPECTION', 'PUBLICATION', 'PAUSED', 'STOPPED', 'COMPLETE'];
const defaults = { submissionMs: 300000, reviewMs: 300000, discussionMs: 180000, inspectionMs: 300000, acceptanceRate: 0.5, minReviews: 3, callsPerInterval: 30, experimentSeconds: 60, maxWorkspaceBytes: 50000000, reviewerTurnover: 0.15, minAuditedReviews: 3, minErrorReviews: 2, maxMeetings: 20, maxProjectCalls: 2000 };

function rulesChecked(input) {
  const rules = { ...defaults, ...input };
  requireThat(Object.keys(rules).every(k => Object.hasOwn(defaults, k)), 'Unknown protocol setting');
  for (const key of Object.keys(defaults).filter(k => !['acceptanceRate', 'reviewerTurnover'].includes(k))) requireThat(Number.isSafeInteger(rules[key]) && rules[key] > 0, `Invalid ${key}`);
  requireThat(rules.acceptanceRate > 0 && rules.acceptanceRate <= 1, 'Invalid acceptanceRate');
  requireThat(rules.reviewerTurnover >= 0.1 && rules.reviewerTurnover <= 0.2, 'Reviewer turnover must be between 10% and 20%');
  return rules;
}

export function languageChecked(value = 'en') {
  requireThat(value === 'en' || value === 'zh', 'Language must be English or Chinese');
  return value;
}

export function teamChecked(members, settings = {}, secretary) {
  requireThat(Array.isArray(members) && members.length >= 2 && members.length <= 12, 'Use 2–12 workers');
  const roster = members.map(m => ({ id: text(m?.id, 'worker id', 48), provider: text(m?.provider, 'provider', 120), model: text(m?.model, 'model', 120), active: true, generation: 0, sessionId: null, commitment: null, calls: 0 }));
  requireThat(roster.every(m => /^[a-z][a-z0-9_-]*$/.test(m.id)) && new Set(roster.map(m => m.id)).size === roster.length, 'Worker IDs must be unique safe identifiers');
  requireThat(roster.every(m => !['constructor', 'prototype', 'human', 'secretary'].includes(m.id)), 'Reserved worker ID');
  const rules = rulesChecked(settings);
  requireThat(rules.minReviews < roster.length, 'minReviews requires enough non-author workers');
  requireThat(new Set(roster.map(m => m.model)).size >= rules.minReviews + 1, 'Independent review requires distinct model IDs');
  const selected = secretary ?? roster[0];
  const secretaryConfig = { provider: text(selected?.provider, 'secretary provider', 120), model: text(selected?.model, 'secretary model', 120) };
  return { roster, rules, secretaryConfig };
}

/** A durable protocol, with no model-selected task assignment or meeting approval. */
export class Protocol {
  constructor(path, { now = () => Date.now() } = {}) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    this.now = now;
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS project (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL); CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, at INTEGER NOT NULL, actor TEXT NOT NULL, kind TEXT NOT NULL, revision INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS configuration (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL);');
  }
  close() { this.db.close(); }
  get state() {
    const row = this.db.prepare('SELECT body FROM project WHERE id=1').get(); if (!row) return null;
    const s = JSON.parse(row.body);
    // Additive migration: preserve the immutable records written by version 0.1.
    s.schemaVersion = 2; s.language = languageChecked(s.language); s.rules = { ...defaults, ...s.rules };
    s.definitions ??= s.definition ? [structuredClone(s.definition)] : [];
    s.amendment ??= null; s.definitionRound ??= 0; s.cases ??= []; s.audits ??= [];
    s.replacementPool ??= []; s.retiredModels ??= []; s.turnover ??= { observations: [], removed: [] };
    s.projectCalls ??= 0; s.humanRecords ??= []; s.acceptanceResults ??= [];
    s.meeting.excluded ??= {}; s.meeting.agenda ??= []; s.meeting.caseResolutions ??= []; s.meeting.retirements ??= [];
    s.meeting.definitionVersion ??= s.definition?.version ?? null;
    s.meeting.definitionSnapshot ??= s.definition ? structuredClone(s.definition) : null;
    s.meeting.rulesSnapshot ??= structuredClone(s.rules);
    return s;
  }
  change(actor, kind, fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const state = this.state;
      const next = fn(state) ?? state;
      requireThat(next && phases.includes(next.phase), 'Invalid project phase');
      next.revision = (state?.revision ?? 0) + 1;
      this.db.prepare('INSERT INTO project VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(next));
      this.db.prepare('INSERT INTO events(at,actor,kind,revision) VALUES (?,?,?,?)').run(this.now(), actor, kind, next.revision);
      this.db.exec('COMMIT');
      return structuredClone(next);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  member(s, actor) {
    const m = s?.members.find(m => m.id === actor && m.active);
    requireThat(m, 'Unknown or inactive worker');
    return m;
  }
  phase(s, ...allowed) { requireThat(s && allowed.includes(s.phase), `Action requires ${allowed.join('/')} phase`); }
  participants(s) { return s.phase === 'RESEARCH' ? s.members.filter(m => m.active && !m.suspended).map(m => m.id) : s.meeting.roster.filter(w => !s.meeting.excluded?.[w] && s.members.some(m => m.id === w && m.active)); }
  eligibleReviewers(s, author, authorModel) { return s.members.filter(m => m.active && !m.suspended && !s.meeting.excluded?.[m.id] && m.id !== author && m.model !== authorModel && !s.retiredModels.includes(m.model)); }
  assignedReviewers(s, author, authorModel, count = s.meeting.rulesSnapshot.minReviews) {
    const eligible = this.eligibleReviewers(s, author, authorModel);
    if (!eligible.length) return [];
    const offset = (s.meeting.number + Math.max(0, s.meeting.roster.indexOf(author))) % eligible.length;
    const rotated = eligible.slice(offset).concat(eligible.slice(0, offset));
    return [...new Map(rotated.map(m => [m.model, m])).values()].slice(0, count);
  }
  open(request, members, settings = {}, secretary, language = 'en') {
    return this.change('human', 'project.opened', existing => {
      requireThat(!existing, 'This state directory already contains a project');
      const { roster, rules, secretaryConfig } = teamChecked(members, settings, secretary);
      return { revision: 0, request: text(request, 'request'), members: roster, rules, secretaryConfig, language: languageChecked(language), phase: 'DEFINITION', definition: null, definitionDraft: null, definitionChecks: {}, meeting: this.newMeeting(0, roster, 'human', 'Initial requirement discussion'), publications: [], failureArchive: [], secretarySessionId: null, runtime: {}, pausedPhase: null };
    });
  }
  get configuration() {
    const row = this.db.prepare('SELECT body FROM configuration WHERE id=1').get();
    return row ? JSON.parse(row.body) : null;
  }
  saveConfiguration(input) {
    requireThat(!this.state, 'A project already exists; edit its team before ratification instead');
    const { roster, rules, secretaryConfig } = teamChecked(input.members, input.settings, input.secretary);
    requireThat(typeof input.request === 'string' && input.request.length <= 24000, 'Request must be text (max 24000)');
    const draft = { request: input.request, members: roster.map(({id,provider,model}) => ({id,provider,model})), settings: rules, secretary: secretaryConfig, language: languageChecked(input.language) };
    this.db.prepare('INSERT INTO configuration VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(JSON.stringify(draft));
  }
  configureTeam(members, settings, secretary, reason, language) {
    return this.change('human', 'team.configured', s => {
      this.phase(s, 'DEFINITION'); requireThat(!s.definition && !s.publications.length, 'Team size can change only before the first goal ratification');
      const { roster, rules, secretaryConfig } = teamChecked(members, settings, secretary);
      const nextLanguage = languageChecked(language ?? s.language);
      for (const member of roster) member.generation = (s.members.find(m => m.id === member.id)?.generation ?? -1) + 1;
      s.humanRecords.push({action:'team_configuration', previousLanguage:s.language, nextLanguage, previous:s.members.map(({id,provider,model})=>({id,provider,model})), next:roster.map(({id,provider,model})=>({id,provider,model})), reason:text(reason,'team change reason'), at:this.now()});
      s.members=roster; s.rules=rules; s.language=nextLanguage; s.secretaryConfig=secretaryConfig; s.secretarySessionId=null;
      s.meeting.roster=roster.map(m=>m.id); s.meeting.excluded={}; s.meeting.rulesSnapshot=structuredClone(rules);
      s.definitionDraft=null; s.definitionChecks={}; s.definitionRound++; s.runtime.requestCounts={};
    });
  }
  newMeeting(number, members, caller, reason) {
    return { id: id(), number, caller, reason, roster: members.filter(m => m.active && !m.suspended).map(m => m.id), statements: [], submissions: {}, reviews: {}, responses: {}, reviewUpdates: {}, commitments: {}, failures: [], decisions: {}, draft: null, checks: {}, excluded: {}, agenda: [], caseResolutions: [], retirements: [], deadline: null, openedAt: this.now() };
  }
  statement(actor, body) {
    return this.change(actor, 'meeting.statement', s => {
      this.member(s, actor); this.phase(s, 'DEFINITION', 'AMENDMENT', 'DISCUSSION');
      requireThat(s.meeting.statements.filter(x => x.actor === actor && x.round === s.definitionRound).length < 12, 'Meeting statement budget reached');
      s.meeting.statements.push({ id: id(), actor, round: s.definitionRound, body: text(body, 'statement', 8000) });
      if (['DEFINITION', 'AMENDMENT'].includes(s.phase)) s.definitionChecks = {};
    });
  }
  draftDefinition(draft) {
    return this.change('secretary', 'definition.drafted', s => {
      this.phase(s, 'DEFINITION', 'AMENDMENT');
      requireThat(this.participants(s).every(w => s.meeting.statements.some(x => x.actor === w && x.round === s.definitionRound)), 'All workers must discuss the original request before the secretary drafts requirements');
      for (const k of ['interpretation', 'scope', 'acceptance', 'stopping']) text(draft[k], k);
      requireThat(Array.isArray(draft.questions) && draft.questions.length > 0, 'Numbered research questions required');
      for (const q of draft.questions) { text(q.id, 'question id', 40); text(q.text, 'question'); }
      requireThat(new Set(draft.questions.map(q => q.id)).size === draft.questions.length, 'Duplicate question IDs');
      text(draft.provenance, 'Human-stated, proposed and unresolved clauses');
      requireThat(Array.isArray(draft.acceptanceChecks) && draft.acceptanceChecks.length > 0 && draft.acceptanceChecks.length <= 20, 'Structured acceptanceChecks required');
      for (const check of draft.acceptanceChecks) {
        for (const k of ['id', 'questionId', 'outcome', 'evaluation', 'method', 'checker', 'pass', 'failure']) text(check[k], `acceptance check ${k}`, 3000);
        requireThat(draft.questions.some(q => q.id === check.questionId), 'Acceptance check must address a question');
      }
      requireThat(new Set(draft.acceptanceChecks.map(c => c.id)).size === draft.acceptanceChecks.length, 'Duplicate acceptance check');
      s.definitionDraft = { ...structuredClone(draft), original: s.request, language: s.language, rules: structuredClone(s.amendment?.rules ?? s.rules) };
      s.definitionChecks = {};
    });
  }
  clarify(body) {
    return this.change('human', 'definition.clarified', s => {
      this.phase(s, 'DEFINITION', 'AMENDMENT');
      s.meeting.statements.push({ id: id(), actor: 'human', body: text(body, 'human clarification', 8000) });
      s.definitionDraft = null; s.definitionChecks = {}; s.definitionRound++;
      // A human-requested revision gets a new bounded drafting/inspection round.
      s.runtime.requestCounts = {};
    });
  }
  checkDefinition(actor, hash, note = '') {
    return this.change(actor, 'definition.checked', s => {
      this.member(s, actor); this.phase(s, 'DEFINITION', 'AMENDMENT');
      requireThat(s.definitionDraft && digest(s.definitionDraft) === hash, 'Stale definition');
      s.definitionChecks[actor] = { hash, note: String(note).slice(0, 8000) };
    });
  }
  ratify(hash) {
    return this.change('human', 'definition.ratified', s => {
      this.phase(s, 'DEFINITION', 'AMENDMENT'); requireThat(s.definitionDraft && digest(s.definitionDraft) === hash, 'Stale definition');
      requireThat(this.participants(s).every(w => s.definitionChecks[w]?.hash === hash), 'Every worker must inspect the definition');
      s.definition = { ...s.definitionDraft, version: (s.definition?.version ?? 0) + 1, confirmedAt: this.now(), confirmations: { interpretation: hash, goalsAndAcceptance: hash } };
      s.definitions.push(structuredClone(s.definition)); s.rules = rulesChecked(s.definition.rules);
      if (s.amendment) { s.meeting.amendment = { ...s.amendment, toVersion: s.definition.version, definition: structuredClone(s.definition) }; s.amendment = null; s.meeting.commitments = {}; }
      else { s.meeting.definitionVersion = s.definition.version; s.meeting.definitionSnapshot = structuredClone(s.definition); s.meeting.rulesSnapshot = structuredClone(s.rules); }
      // Even the first meeting needs commitments and a checked bulletin.
      s.phase = 'DISCUSSION'; s.meeting.deadline = this.now() + s.rules.discussionMs;
    });
  }
  callMeeting(actor, reason) {
    return this.change(actor, 'meeting.called', s => {
      if (actor !== 'human') this.member(s, actor);
      if (s.phase !== 'RESEARCH') { this.phase(s, 'SUBMISSION', 'REVIEW', 'DISCUSSION', 'AMENDMENT', 'BULLETIN', 'INSPECTION'); s.meeting.agenda.push({ actor, reason: text(reason, 'agenda item', 1200), at: this.now() }); this.invalidateBulletin(s); return; }
      s.meeting = this.newMeeting(s.meeting.number + 1, s.members, actor, text(reason, 'meeting reason', 1200));
      requireThat(s.meeting.roster.length > 0, 'No active workers');
      s.meeting.definitionVersion = s.definition.version; s.meeting.definitionSnapshot = structuredClone(s.definition); s.meeting.rulesSnapshot = structuredClone(s.rules);
      s.phase = 'SUBMISSION'; s.meeting.deadline = this.now() + s.rules.submissionMs;
    });
  }
  submit(actor, paper) {
    return this.change(actor, 'paper.submitted', s => {
      this.member(s, actor); this.phase(s, 'SUBMISSION');
      requireThat(this.now() <= s.meeting.deadline, 'Submission deadline passed');
      requireThat(!s.meeting.submissions[actor], 'Exactly one submission per worker per meeting');
      requireThat(paper.questionIds?.length && paper.questionIds.every(q => s.definition.questions.some(x => x.id === q)), 'Paper must address ratified questions');
      for (const k of ['title', 'contribution', 'releaseUrl', 'artifactHash', 'license']) text(paper[k], k);
      requireThat(paper.pages >= 1 && paper.pages <= 10 && paper.experiments?.length, 'A paper needs ≤10 pages and executed experimental evidence');
      requireThat(!s.publications.some(p => Object.values(p.submissions ?? {}).some(old => old.contentHash === paper.contentHash)), 'Unchanged resubmission is not a contribution');
      const member = this.member(s, actor);
      let prior;
      if (paper.supersedes) {
        prior = s.publications.flatMap(p => Object.values(p.submissions)).find(p => p.artifactHash === paper.supersedes);
        requireThat(prior?.author === actor, 'A revision must identify your own earlier paper');
      }
      s.meeting.submissions[actor] = { ...structuredClone(paper), paperId: prior?.paperId ?? prior?.artifactHash ?? id(), author: actor, authorModel: member.model, generation: member.generation, definitionVersion: s.meeting.definitionVersion, version: prior ? prior.version + 1 : 1 };
    });
  }
  startReview() {
    return this.change('protocol', 'review.opened', s => {
      this.phase(s, 'SUBMISSION');
      requireThat(s.meeting.roster.every(w => s.meeting.submissions[w]) || this.now() >= s.meeting.deadline, 'Submission window still open');
      for (const w of s.meeting.roster) if (!s.meeting.submissions[w]) s.meeting.decisions[w] = { outcome: 'rejected', reason: 'submission_failure' };
      s.phase = 'REVIEW'; s.meeting.deadline = this.now() + s.rules.reviewMs;
    });
  }
  review(actor, author, review, update = false) {
    return this.change(actor, update ? 'review.updated' : 'review.submitted', s => {
      const reviewer = this.member(s, actor), writer = this.member(s, author);
      this.phase(s, update ? 'DISCUSSION' : 'REVIEW');
      requireThat(actor !== author && reviewer.model !== writer.model, 'Self or same-model review forbidden');
      const paper = s.meeting.submissions[author]; requireThat(paper, 'Unknown paper');
      requireThat(review.artifactHash === paper.artifactHash, 'Review must identify frozen artifact version');
      for (const k of ['soundness', 'excitement', 'overall', 'confidence']) requireThat(Number.isFinite(review[k]) && review[k] >= 1 && review[k] <= 5, `Invalid ${k}`);
      for (const k of ['summary', 'evidence', 'limitations', 'reproducibility']) text(review[k], k, 10000);
      requireThat(typeof review.majorCorrectnessObjection === 'boolean', 'Explicit correctness-objection status required');
      const key = `${author}:${actor}`;
      requireThat(update ? s.meeting.reviews[key] && !s.meeting.reviewUpdates[key] : !s.meeting.reviews[key], 'Only one initial review and one update allowed');
      const target = update ? s.meeting.reviewUpdates : s.meeting.reviews;
      target[key] = { ...structuredClone(review), reviewer: actor, reviewerModel: reviewer.model, author, revision: update ? 2 : 1 };
    });
  }
  releaseReviews() {
    return this.change('protocol', 'reviews.released', s => {
      this.phase(s, 'REVIEW');
      const complete = Object.keys(s.meeting.submissions).every(author => this.reviewsFor(s, author).length >= s.rules.minReviews);
      requireThat(complete || this.now() >= s.meeting.deadline, 'Independent review window still open');
      s.phase = 'DISCUSSION'; s.meeting.deadline = this.now() + s.rules.discussionMs;
    });
  }
  reviewsFor(s, author) {
    const reviews = Object.entries(s.meeting.reviews).filter(([, r]) => r.author === author).map(([k, r]) => s.meeting.reviewUpdates[k] ?? r);
    return [...new Map(reviews.filter(r => !s.retiredModels.includes(r.reviewerModel ?? s.members.find(m => m.id === r.reviewer).model)).map(r => [r.reviewerModel ?? s.members.find(m => m.id === r.reviewer).model, r])).values()];
  }
  respond(actor, body) {
    return this.change(actor, 'author.responded', s => {
      this.member(s, actor); this.phase(s, 'DISCUSSION');
      requireThat(s.meeting.submissions[actor] && !s.meeting.responses[actor], 'One response per submitted paper');
      s.meeting.responses[actor] = text(body, 'response', 10000);
    });
  }
  commit(actor, commitment, failures = []) {
    return this.change(actor, 'research.committed', s => {
      this.member(s, actor); this.phase(s, 'DISCUSSION');
      requireThat(s.definition.questions.some(q => q.id === commitment.questionId), 'Commitment must address a ratified question');
      for (const k of ['investigation', 'expectedObservation', 'budget', 'stopping', 'priorFailures']) text(commitment[k], k, 4000);
      requireThat(Array.isArray(failures) && failures.length <= 10, 'At most ten compact failure entries');
      for (const f of failures) for (const k of ['attempt', 'conditions', 'observation', 'uncertainty', 'implication', 'evidence']) text(f[k], k, 4000);
      s.meeting.commitments[actor] = structuredClone(commitment);
      s.meeting.failures = s.meeting.failures.filter(f => f.worker !== actor).concat(failures.map(f => ({ ...structuredClone(f), worker: actor })));
    });
  }
  decide() {
    return this.change('protocol', 'selection.frozen', s => {
      this.phase(s, 'DISCUSSION');
      requireThat(!s.amendment, 'Ratify or cancel the pending amendment first');
      requireThat(this.participants(s).every(w => s.meeting.commitments[w]), 'All workers must record next commitments');
      const eligible = [];
      for (const [author] of Object.entries(s.meeting.submissions)) {
        const rs = this.reviewsFor(s, author);
        if (rs.length < s.meeting.rulesSnapshot.minReviews) { s.meeting.decisions[author] = { outcome: 'pending', reason: 'insufficient_independent_reviews' }; continue; }
        const score = median(rs.map(r => r.overall)), soundness = median(rs.map(r => r.soundness));
        if (rs.some(r => r.majorCorrectnessObjection)) { s.meeting.decisions[author] = { outcome: 'pending', reason: 'unresolved_correctness_objection', score, soundness }; continue; }
        if (soundness < 3 || score < 3.5) s.meeting.decisions[author] = { outcome: 'rejected', reason: 'quality', score, soundness };
        else eligible.push({ author, score, soundness });
      }
      eligible.sort((a, b) => b.score - a.score || b.soundness - a.soundness);
      const capacity = Math.floor(s.meeting.roster.length * s.meeting.rulesSnapshot.acceptanceRate);
      for (let i = 0; i < eligible.length; i++) {
        const e = eligible[i], boundary = capacity > 0 && eligible[capacity - 1], next = eligible[capacity];
        const tied = boundary && next && boundary.score === next.score && boundary.soundness === next.soundness && e.score === boundary.score && e.soundness === boundary.soundness;
        s.meeting.decisions[e.author] = { outcome: tied ? 'pending' : i < capacity ? 'accepted' : 'rejected', reason: tied ? 'capacity_tie' : i < capacity ? 'quality_and_capacity' : 'capacity', score: e.score, soundness: e.soundness };
      }
      s.meeting.missingResponses = Object.keys(s.meeting.submissions).filter(w => !s.meeting.responses[w]);
      this.planTurnover(s); this.decideCases(s);
      s.phase = 'BULLETIN'; s.meeting.deadline = null;
    });
  }
  draftBulletin(draft) {
    return this.change('secretary', 'bulletin.drafted', s => {
      this.phase(s, 'BULLETIN', 'INSPECTION');
      for (const k of ['summary', 'progress', 'consensus', 'dissent', 'humanDecisions']) text(draft[k], k, 18000);
      s.meeting.draft = structuredClone(draft); s.meeting.checks = {}; s.phase = 'INSPECTION'; s.meeting.deadline = this.now() + s.rules.inspectionMs;
    });
  }
  checkBulletin(actor, hash, approved, note) {
    return this.change(actor, 'bulletin.checked', s => {
      this.member(s, actor); this.phase(s, 'INSPECTION');
      requireThat(digest(s.meeting.draft) === hash, 'Stale bulletin draft');
      requireThat(typeof approved === 'boolean', 'Explicit inspection response required');
      s.meeting.checks[actor] = { hash, approved, note: text(note, 'inspection explanation', 8000) };
    });
  }
  preparePublication() {
    return this.change('protocol', 'publication.prepared', s => {
      this.phase(s, 'INSPECTION');
      const hash = digest(s.meeting.draft);
      requireThat(this.participants(s).every(w => s.meeting.checks[w]?.approved && s.meeting.checks[w]?.hash === hash), 'All workers must confirm recording fidelity; correct objections before publication');
      s.phase = 'PUBLICATION';
    });
  }
  invalidateBulletin(s) {
    if (['BULLETIN', 'INSPECTION'].includes(s.phase)) { s.meeting.draft = null; s.meeting.checks = {}; s.phase = 'BULLETIN'; }
  }
  requestAmendment(body, settings) {
    text(body, 'amendment and reason'); rulesChecked({ ...this.state?.rules, ...settings });
    if (this.state?.phase === 'PAUSED' && this.state.pausedPhase === 'RESEARCH') this.resume();
    if (this.state?.phase === 'RESEARCH') this.callMeeting('human', 'Human request to amend the research definition');
    return this.change('human', 'amendment.requested', s => {
      this.phase(s, 'SUBMISSION', 'REVIEW', 'DISCUSSION', 'BULLETIN', 'INSPECTION');
      requireThat(!s.amendment, 'An amendment is already pending');
      const proposedRules = rulesChecked({ ...s.rules, ...settings });
      s.amendment = { request: text(body, 'amendment and reason'), fromVersion: s.definition.version, previous: structuredClone(s.definition), rules: proposedRules, at: this.now() };
      s.meeting.agenda.push({ actor: 'human', reason: s.amendment.request, at: this.now() });
      if (['BULLETIN', 'INSPECTION'].includes(s.phase)) { s.meeting.draft = null; s.meeting.checks = {}; s.phase = 'DISCUSSION'; }
    });
  }
  beginAmendment() {
    return this.change('protocol', 'amendment.discussion', s => {
      this.phase(s, 'DISCUSSION'); requireThat(s.amendment, 'No amendment pending');
      s.phase = 'AMENDMENT'; s.definitionRound++; s.definitionDraft = null; s.definitionChecks = {};
      s.meeting.deadline = null;
    });
  }
  cancelAmendment(reason) {
    return this.change('human', 'amendment.cancelled', s => {
      requireThat(s.amendment, 'No amendment pending');
      s.meeting.cancelledAmendment = { ...s.amendment, reason: text(reason, 'cancellation reason') };
      s.amendment = null; s.definitionDraft = null; s.definitionChecks = {};
      if (s.phase === 'AMENDMENT') { s.phase = 'DISCUSSION'; s.meeting.deadline = this.now() + s.rules.discussionMs; }
    });
  }
  exclude(actor, reason) {
    return this.change('human', 'participant.excluded', s => {
      this.phase(s, 'DEFINITION', 'AMENDMENT', 'SUBMISSION', 'REVIEW', 'DISCUSSION', 'BULLETIN', 'INSPECTION');
      this.member(s, actor); requireThat(this.participants(s).includes(actor), 'Participant is already excluded');
      requireThat(this.participants(s).length > 1, 'Cannot exclude every participant');
      s.meeting.excluded[actor] = { reason: text(reason, 'unavailability and exclusion reason'), at: this.now() };
      this.invalidateBulletin(s);
    });
  }
  retry(actor, reason) {
    return this.change('human', 'participant.retry', s => {
      requireThat(!['STOPPED', 'COMPLETE', 'PUBLICATION'].includes(s.phase), 'Retry is unavailable in this phase');
      if (actor !== 'secretary') this.member(s, actor);
      s.humanRecords.push({ action: 'retry', actor, reason: text(reason, 'retry reason'), meetingId: s.meeting.id, at: this.now() });
      for (const key of Object.keys(s.runtime.requestCounts ?? {})) if (key.split(':')[3] === actor) delete s.runtime.requestCounts[key];
      // Restarts the same session; it does not erase a model's review history.
      if (actor !== 'secretary') this.member(s, actor).calls = 0;
    });
  }
  extendWindow(milliseconds, reason) {
    return this.change('human', 'window.extended', s => {
      this.phase(s, 'SUBMISSION', 'REVIEW', 'DISCUSSION', 'INSPECTION');
      requireThat(Number.isSafeInteger(milliseconds) && milliseconds > 0 && milliseconds <= 86400000, 'Extension must be positive and at most one day');
      s.meeting.deadline = Math.max(this.now(), s.meeting.deadline ?? this.now()) + milliseconds;
      s.meeting.agenda.push({ actor: 'human', reason: text(reason, 'window extension reason'), milliseconds, at: this.now() });
    });
  }
  grantCalls(calls, reason) {
    return this.change('human', 'budget.extended', s => {
      requireThat(s && !['STOPPED', 'COMPLETE'].includes(s.phase), 'Project is closed');
      requireThat(Number.isSafeInteger(calls) && calls > 0 && calls <= 10000, 'Grant 1–10000 additional model calls');
      s.rules.maxProjectCalls += calls;
      if (s.amendment) s.amendment.rules.maxProjectCalls = Math.max(s.amendment.rules.maxProjectCalls, s.rules.maxProjectCalls);
      s.humanRecords.push({ action: 'budget_extension', calls, reason: text(reason, 'human budget extension reason'), meetingId: s.meeting.id, at: this.now() });
      this.invalidateBulletin(s);
    });
  }
  reinstate(actor, reason) {
    return this.change('human', 'participant.reinstated', s => {
      this.phase(s, 'RESEARCH', 'PAUSED');
      const m = this.member(s, actor); requireThat(m.suspended, 'Participant is not suspended');
      m.suspended = false;
      s.humanRecords.push({ action: 'reinstate', actor, reason: text(reason, 'reinstatement reason'), at: this.now() });
    });
  }
  setPool(pool) {
    return this.change('human', 'replacement.pool', s => {
      requireThat(Array.isArray(pool) && pool.length <= 40, 'Use at most forty eligible replacement models');
      const entries = pool.map(m => ({ provider: text(m.provider, 'provider', 120), model: text(m.model, 'model', 120) }));
      requireThat(new Set(entries.map(m => m.model)).size === entries.length, 'Duplicate replacement model');
      requireThat(entries.every(m => !s.retiredModels.includes(m.model) && !s.members.some(w => w.active && w.model === m.model)), 'Replacement must be a new, non-retired model');
      s.replacementPool = entries;
      s.humanRecords.push({ action: 'replacement_pool', models: entries, meetingId: s.meeting.id, at: this.now() });
      if (['BULLETIN', 'INSPECTION'].includes(s.phase)) this.planTurnover(s);
      this.invalidateBulletin(s);
    });
  }
  fillSeat(actor, model) {
    return this.change('human', 'seat.filled', s => {
      this.phase(s, 'RESEARCH', 'PAUSED');
      const seat = s.members.find(m => m.id === actor); requireThat(seat && !seat.active, 'Seat must be vacant');
      const entry = s.replacementPool.find(m => m.model === model); requireThat(entry, 'Choose a model from the eligible pool');
      Object.assign(seat, entry, { active: true, suspended: false, generation: seat.generation + 1, sessionId: null, calls: 0 });
      s.replacementPool = s.replacementPool.filter(m => m.model !== model);
      s.humanRecords.push({ action: 'seat_filled', actor, model, at: this.now() });
    });
  }
  repairRoute(actor, provider, model, reason) {
    return this.change('human', 'worker.route_repaired', s => {
      this.phase(s, 'DEFINITION'); requireThat(s.publications.length === 0, 'Only initial configuration can be repaired in place');
      const member = this.member(s, actor);
      text(provider, 'provider', 120); text(model, 'model', 120); text(reason, 'route repair reason');
      requireThat(new Set(s.members.map(m => m.id === actor ? model : m.model)).size >= s.rules.minReviews + 1, 'Preserve enough distinct review models');
      Object.assign(member,{provider,model,sessionId:null,generation:member.generation+1});
      s.humanRecords.push({action:'route_repair',actor,provider,model,reason,meetingId:s.meeting.id,at:this.now()});
      s.definitionDraft=null;s.definitionChecks={};s.definitionRound++;s.runtime.requestCounts={};
    });
  }
  queueReplacement(actor, model, reason) {
    return this.change('human', 'seat.replacement_requested', s => {
      this.phase(s, 'DEFINITION', 'AMENDMENT', 'SUBMISSION', 'REVIEW', 'DISCUSSION', 'BULLETIN', 'INSPECTION');
      const member=this.member(s,actor),entry=s.replacementPool.find(m=>m.model===model);requireThat(entry,'Choose an eligible replacement model');
      s.meeting.replacements??={};
      requireThat(!Object.entries(s.meeting.replacements).some(([w,r])=>w!==actor&&r.replacement.model===model),'Replacement is reserved for another seat');
      s.meeting.replacements[actor]={oldModel:member.model,replacement:entry,reason:text(reason,'replacement reason')};
      this.planTurnover(s);this.invalidateBulletin(s);
    });
  }
  setSecretary(actor, reason, selected) {
    return this.change('human', 'secretary.model', s => {
      requireThat(!['STOPPED', 'COMPLETE', 'PUBLICATION'].includes(s.phase), 'Project is closed or publishing');
      const member = selected ?? this.member(s, actor);
      if (!selected) requireThat(!member.suspended && !s.meeting.excluded[actor], 'Choose an available worker model');
      text(member.provider, 'secretary provider', 120); text(member.model, 'secretary model', 120);
      requireThat(!s.retiredModels.includes(member.model), 'Choose a non-retired secretary model');
      s.secretaryConfig = { provider: member.provider, model: member.model }; s.secretarySessionId = null;
      s.humanRecords.push({ action: 'secretary_model', provider: member.provider, model: member.model, reason: text(reason, 'secretary recovery reason'), meetingId: s.meeting.id, at: this.now() });
      this.invalidateBulletin(s);
    });
  }
  fileAppeal(actor, meetingId, reason, evidence) {
    return this.change(actor, 'appeal.filed', s => {
      this.member(s, actor); this.phase(s, 'SUBMISSION', 'DISCUSSION');
      const publication = s.publications.find(p => p.id === meetingId), paper = publication?.submissions[actor];
      requireThat(paper, 'A published submitted paper is required');
      requireThat(['rejected', 'pending'].includes(this.paperDecision(s, paper.artifactHash)?.outcome), 'Only rejected or pending papers can be appealed');
      requireThat(!s.cases.some(c => c.paper.artifactHash === paper.artifactHash && c.kind === 'appeal'), 'One appeal per frozen paper version');
      requireThat(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= 10, 'Specific evidence references required');
      evidence.forEach(x => text(x, 'evidence reference', 2000));
      const old = s.cases.find(c => c.paper.artifactHash === paper.artifactHash && c.status === 'open');
      if (old) { old.kind = 'appeal'; old.reason = text(reason, 'appeal reason'); old.evidence = evidence; }
      else s.cases.push(this.newCase(s, publication, actor, 'appeal', text(reason, 'appeal reason'), evidence));
    });
  }
  newCase(s, publication, author, kind, reason, evidence = []) {
    const paper = publication.submissions[author];
    return { id: id(), kind, sourceMeetingId: publication.id, sourceMeetingNumber: publication.number, author, authorModel: paper.authorModel ?? s.members.find(m => m.id === author)?.model, generation: paper.generation ?? 0, paper: structuredClone(paper), definition: publication.definitionSnapshot ?? s.definitions.find(d => d.version === publication.definitionVersion), rules: publication.rulesSnapshot ?? structuredClone(s.rules), reason, evidence, status: 'open', reviews: {}, attempts: {}, openedAt: this.now() };
  }
  fileCorrection(actor, hash, reason, evidence) {
    return this.change(actor, 'correction.requested', s => {
      this.member(s, actor); this.phase(s, 'SUBMISSION', 'DISCUSSION');
      const publication = s.publications.find(p => Object.values(p.submissions).some(paper => paper.artifactHash === hash));
      requireThat(publication && this.paperDecision(s, hash)?.outcome === 'accepted', 'Correction must reference an accepted frozen publication');
      requireThat(!s.cases.some(c => c.paper.artifactHash === hash && c.status === 'open'), 'An examination of this paper is already open');
      requireThat(Array.isArray(evidence) && evidence.length > 0 && evidence.length <= 10, 'Independent evidence references required');
      evidence.forEach(x => text(x, 'correction evidence', 2000));
      const author = Object.keys(publication.submissions).find(a => publication.submissions[a].artifactHash === hash);
      const c = this.newCase(s, publication, author, 'correction', text(reason, 'correction reason'), evidence); c.reporter = actor; s.cases.push(c);
    });
  }
  paperDecision(s, hash) {
    const resolution = [...s.cases].reverse().find(c => c.paper.artifactHash === hash && c.status === 'resolved');
    if (resolution) return resolution.resolution;
    const p = s.publications.find(p => Object.values(p.submissions).some(x => x.artifactHash === hash));
    return p ? p.decisions[Object.keys(p.submissions).find(a => p.submissions[a].artifactHash === hash)] : null;
  }
  caseReview(actor, caseId, review) {
    return this.change(actor, 'appeal.reviewed', s => {
      this.phase(s, 'DISCUSSION');
      const c = s.cases.find(c => c.id === caseId && c.status === 'open'); requireThat(c, 'No open case');
      const reviewer = this.member(s, actor);
      requireThat(this.eligibleReviewers(s, c.author, c.authorModel).some(m => m.id === actor), 'Conflicted or ineligible case reviewer');
      requireThat(c.attempts[reviewer.model] !== s.meeting.id, 'One case assessment per model per meeting');
      requireThat(review.artifactHash === c.paper.artifactHash, 'Review must identify frozen artifact version');
      for (const k of ['soundness', 'excitement', 'overall', 'confidence']) requireThat(Number.isFinite(review[k]) && review[k] >= 1 && review[k] <= 5, `Invalid ${k}`);
      for (const k of ['summary', 'evidence', 'limitations', 'reproducibility']) text(review[k], k, 10000);
      requireThat(typeof review.majorCorrectnessObjection === 'boolean', 'Explicit correctness-objection status required');
      c.reviews[reviewer.model] = { ...structuredClone(review), reviewer: actor, reviewerModel: reviewer.model, author: c.author, meetingId: s.meeting.id };
      c.attempts[reviewer.model] = s.meeting.id;
    });
  }
  decideCases(s) {
    const groups = new Map();
    for (const c of s.cases.filter(c => c.status === 'open' && !c.proposed && c.kind !== 'correction')) {
      const rs = Object.values(c.reviews).filter(r => !s.retiredModels.includes(r.reviewerModel) && !s.meeting.retirements.some(x => x.model === r.reviewerModel));
      if (rs.length < c.rules.minReviews || rs.some(r => r.majorCorrectnessObjection)) continue;
      const score = median(rs.map(r => r.overall)), soundness = median(rs.map(r => r.soundness));
      if (score < 3.5 || soundness < 3) c.proposed = { outcome: 'rejected', reason: 'quality_after_reexamination', score, soundness };
      else { if (!groups.has(c.sourceMeetingId)) groups.set(c.sourceMeetingId, []); groups.get(c.sourceMeetingId).push({ c, score, soundness }); }
    }
    for (const [source, eligible] of groups) {
      const p = s.publications.find(p => p.id === source);
      const accepted = Object.values(p.submissions).filter(paper => this.paperDecision(s, paper.artifactHash)?.outcome === 'accepted').length;
      const reserved = s.cases.filter(c => c.sourceMeetingId === source && c.proposed?.outcome === 'accepted').length;
      const capacity = Math.max(0, Math.floor(p.roster.length * eligible[0].c.rules.acceptanceRate) - accepted - reserved);
      eligible.sort((a,b) => b.score-a.score || b.soundness-a.soundness);
      const boundary=eligible[capacity-1],next=eligible[capacity];
      for (let i=0;i<eligible.length;i++) {
        const {c,score,soundness}=eligible[i];
        if (boundary && next && boundary.score===next.score && boundary.soundness===next.soundness && score===boundary.score && soundness===boundary.soundness) continue;
        c.proposed={outcome:i<capacity?'accepted':'rejected',reason:i<capacity?'quality_and_capacity_after_reexamination':'capacity_after_reexamination',score,soundness};
      }
    }
    for (const c of s.cases.filter(c=>c.status==='open'&&c.proposed)) if (!s.meeting.caseResolutions.some(x=>x.caseId===c.id)) s.meeting.caseResolutions.push({caseId:c.id,...c.proposed});
  }
  resolveCase(caseId, outcome, reason, evidence) {
    return this.change('human', 'appeal.adjudicated', s => {
      this.phase(s, 'DISCUSSION', 'BULLETIN', 'INSPECTION');
      const c = s.cases.find(c => c.id === caseId && c.status === 'open'); requireThat(c, 'No open case');
      requireThat((c.kind === 'correction' ? ['accepted', 'retracted', 'pending'] : ['accepted', 'rejected', 'pending']).includes(outcome), 'Invalid case outcome');
      text(reason, 'reason for adjudication'); text(evidence, 'independently checkable evidence');
      if (outcome === 'accepted') {
        const rs = Object.values(c.reviews).filter(r => !s.retiredModels.includes(r.reviewerModel));
        requireThat(rs.length >= c.rules.minReviews && median(rs.map(r => r.soundness)) >= 3 && median(rs.map(r => r.overall)) >= 3.5, 'The declared independent-review quality gate still applies');
        const p = s.publications.find(p => p.id === c.sourceMeetingId);
        const used = Object.values(p.submissions).filter(paper => this.paperDecision(s, paper.artifactHash)?.outcome === 'accepted').length + s.cases.filter(x => x.id !== c.id && x.sourceMeetingId === p.id && x.proposed?.outcome === 'accepted').length;
        requireThat(c.kind === 'correction' || used < Math.floor(p.roster.length * c.rules.acceptanceRate), 'The original publication capacity is exhausted');
      }
      c.proposed = outcome === 'pending' ? null : { outcome, reason: text(reason, 'reason'), evidence, by: 'human' };
      s.meeting.caseResolutions = s.meeting.caseResolutions.filter(x => x.caseId !== caseId);
      s.meeting.caseResolutions.push({ caseId, outcome, reason, evidence, by: 'human' });
      this.invalidateBulletin(s);
    });
  }
  recordAudit(actor, author, review, checks, caseId = null) {
    return this.change('evidence-verifier', 'review.audited', s => {
      const model = this.member(s, actor).model;
      const key = `${s.meeting.id}:${caseId ?? author}:${model}`;
      const previous = s.audits.find(a => a.key === key);
      const audit = { id: previous?.id ?? id(), key, meetingId: s.meeting.id, updatedMeetingId: s.meeting.id, reviewer: actor, model, author, artifactHash: review.artifactHash, reviewHash: digest(review), checks: structuredClone(checks), status: 'verified', revisions: [...(previous?.revisions ?? []), ...(previous ? [{ reviewHash: previous.reviewHash, checks: previous.checks }] : [])] };
      if (previous) s.audits[s.audits.indexOf(previous)] = audit; else s.audits.push(audit);
    });
  }
  manualAudit(meetingId, author, reviewer, category, finding, evidence) {
    return this.change('human', 'review.manual_audit', s => {
      this.phase(s, 'DISCUSSION', 'BULLETIN', 'INSPECTION');
      requireThat(['fabrication', 'material_misreading', 'unsupported_factual_score', 'refusal_to_correct', 'missed_declared_defect'].includes(category), 'Audit only factual reliability, never subjective importance');
      const meeting = meetingId === s.meeting.id ? s.meeting : s.publications.find(p => p.id === meetingId);
      const review = meeting?.reviewUpdates[`${author}:${reviewer}`] ?? meeting?.reviews[`${author}:${reviewer}`];
      requireThat(review, 'Unknown frozen review');
      text(finding, 'specific factual error and review location'); text(evidence, 'independently checkable evidence');
      const model = review.reviewerModel ?? s.members.find(m => m.id === reviewer)?.model;
      const key = `${meetingId}:${author}:${model}`;
      let audit = s.audits.find(a => a.key === key);
      if (!audit) { audit = { id: id(), key, meetingId, reviewer, model, author, artifactHash: review.artifactHash, reviewHash: digest(review), checks: [], revisions: [], status: 'verified' }; s.audits.push(audit); }
      requireThat(!audit.checks.some(c => c.category === category && c.finding === finding), 'Duplicate factual finding');
      audit.updatedMeetingId=s.meeting.id;
      audit.checks.push({ category, finding, evidence, outcome: 'contradicted', verifier: 'human' });
      this.planTurnover(s); this.invalidateBulletin(s);
    });
  }
  contestAudit(actor, auditId, reason, evidence) {
    return this.change(actor, 'audit.contested', s => {
      this.phase(s, 'DISCUSSION', 'BULLETIN', 'INSPECTION'); this.member(s, actor);
      const audit = s.audits.find(a => a.id === auditId); requireThat(audit, 'Unknown audit');
      requireThat(!audit.contest, 'Audit has already been contested');
      audit.contest = { actor, reason: text(reason, 'audit objection'), evidence: text(evidence, 'independent evidence') }; audit.status = 'contested'; audit.updatedMeetingId=s.meeting.id;
      s.meeting.retirements = s.meeting.retirements.filter(r => r.model !== audit.model);
      this.invalidateBulletin(s);
    });
  }
  adjudicateAudit(auditId, upheld, reason, evidence) {
    return this.change('human', 'audit.adjudicated', s => {
      this.phase(s, 'DISCUSSION', 'BULLETIN', 'INSPECTION');
      const audit = s.audits.find(a => a.id === auditId); requireThat(audit, 'Unknown audit');
      requireThat(typeof upheld === 'boolean', 'Choose whether the evidence finding is upheld');
      audit.adjudication = { upheld, reason: text(reason, 'reason'), evidence: text(evidence, 'independent evidence'), at: this.now() };
      audit.status = upheld ? 'verified' : 'overturned'; audit.updatedMeetingId=s.meeting.id;
      this.planTurnover(s); this.invalidateBulletin(s);
    });
  }
  reviewerStats(s = this.state) {
    const models = [...new Set(s.audits.map(a => a.model))];
    return models.map(model => {
      const audited = s.audits.filter(a => a.model === model && a.status === 'verified' && a.checks.length);
      const errors = audited.filter(a => a.checks.some(c => c.outcome === 'contradicted'));
      return { model, auditedReviews: audited.length, errorReviews: errors.length, errorRate: audited.length ? errors.length / audited.length : null, contested: s.audits.filter(a => a.model === model && a.status === 'contested').length, retired: s.retiredModels.includes(model) };
    });
  }
  planTurnover(s) {
    if (s.meeting.number === 0) return;
    const stats = this.reviewerStats(s);
    for (const stat of stats.filter(x => x.auditedReviews >= s.rules.minAuditedReviews && !x.retired)) {
      const key = `${s.meeting.id}:${stat.model}`;
      if (!s.turnover.observations.includes(key)) s.turnover.observations.push(key);
    }
    const allowance = Math.max(0, Math.floor(s.turnover.observations.length * s.rules.reviewerTurnover) - s.turnover.removed.length);
    const candidates = stats.filter(x => !x.retired && !x.contested && x.auditedReviews >= s.rules.minAuditedReviews && x.errorReviews >= s.rules.minErrorReviews && x.errorRate >= 0.5 && s.members.some(m => m.active && m.model === x.model && !s.meeting.replacements?.[m.id]));
    candidates.sort((a, b) => b.errorRate - a.errorRate || b.errorReviews - a.errorReviews || a.model.localeCompare(b.model));
    const available=s.replacementPool.filter(m=>!Object.values(s.meeting.replacements??{}).some(r=>r.replacement.model===m.model));
    s.meeting.retirements = candidates.slice(0, allowance).map((stat, index) => ({ ...stat, replacement: available[index] ?? null, reason: 'Repeated independently verified factual contradictions; no penalty for subjective scores or unresolved claims.' }));
    const retiring = new Set(s.meeting.retirements.map(r => r.model));
    for (const author of Object.keys(s.meeting.submissions)) {
      if (this.reviewsFor(s, author).filter(r => !retiring.has(r.reviewerModel)).length < s.meeting.rulesSnapshot.minReviews) s.meeting.decisions[author] = { outcome: 'pending', reason: 'insufficient_reliable_reviews' };
    }
  }
  acceptanceResult(actor, result) {
    return this.change(actor, 'acceptance.observed', s => {
      if (actor !== 'human') this.member(s, actor);
      this.phase(s, 'DISCUSSION');
      const check = s.definition.acceptanceChecks?.find(c => c.id === result.checkId); requireThat(check, 'Unknown acceptance check');
      requireThat(['pass', 'fail', 'inconclusive'].includes(result.outcome), 'Invalid acceptance outcome');
      text(result.evidence, 'acceptance evidence'); text(result.reason, 'acceptance reasoning');
      s.acceptanceResults.push({ actor, definitionVersion: s.definition.version, meetingId: s.meeting.id, checkId: check.id, outcome: result.outcome, evidence: result.evidence, reason: result.reason });
    });
  }
  complete(outcome, reason) {
    return this.change('human', 'project.completed', s => {
      this.phase(s, 'RESEARCH', 'PAUSED');
      requireThat(s.phase !== 'PAUSED' || s.pausedPhase === 'RESEARCH', 'Complete only after the publication boundary');
      requireThat(['accepted', 'infeasible', 'inconclusive'].includes(outcome), 'Distinguish adoption, infeasibility and inconclusive completion');
      if (outcome === 'accepted') requireThat(s.definition.acceptanceChecks?.every(check => [...s.acceptanceResults].reverse().find(r => r.definitionVersion === s.definition.version && r.checkId === check.id)?.outcome === 'pass'), 'Every current acceptance check needs a recorded pass');
      s.completion = { outcome, reason: text(reason, 'human completion decision'), at: this.now(), definitionVersion: s.definition.version };
      s.phase = 'COMPLETE';
    });
  }
  publish(record) {
    return this.change('protocol', 'publication.committed', s => {
      this.phase(s, 'PUBLICATION');
      requireThat(record.meetingId === s.meeting.id && record.pages > 0 && record.pages <= 10 && record.hash, 'Checked publication receipt required');
      const published = { ...structuredClone(s.meeting), publication: record, nextDefinitionVersion: s.definition.version, publishedAt: this.now() };
      s.publications.push(published);
      for (const [author, decision] of Object.entries(s.meeting.decisions)) if (decision.outcome === 'pending' && !s.cases.some(c => c.paper.artifactHash === s.meeting.submissions[author]?.artifactHash)) s.cases.push(this.newCase(s, published, author, 'pending', decision.reason));
      for (const member of s.members) {
        const decision = s.meeting.decisions[member.id];
        if (!s.meeting.roster.includes(member.id)) continue;
        if (decision?.outcome === 'rejected') {
          member.generation++; member.sessionId = null;
          member.rejection = { paper: s.meeting.submissions[member.id] ?? null, decision, reviews: this.reviewsFor(s, member.id), response: s.meeting.responses[member.id] ?? null };
        }
        member.commitment = s.meeting.commitments[member.id] ?? member.commitment ?? null; member.calls = 0;
        if (s.meeting.excluded[member.id]) { member.suspended = true; member.sessionId = null; if (decision?.outcome !== 'rejected') member.generation++; }
      }
      for (const c of s.cases.filter(c => c.status === 'open' && c.proposed)) {
        c.status = 'resolved'; c.resolution = { ...c.proposed, meetingId: s.meeting.id, at: this.now() }; delete c.proposed;
        const member = s.members.find(m => m.id === c.author);
        if (c.resolution.outcome === 'rejected' && member?.model === c.authorModel && member.generation === c.generation) {
          member.generation++; member.sessionId = null; member.rejection = { paper: c.paper, decision: c.resolution, reviews: Object.values(c.reviews), response: c.reason };
        }
      }
      for (const retirement of s.meeting.retirements) {
        s.retiredModels.push(retirement.model); s.turnover.removed.push({ model: retirement.model, meetingId: s.meeting.id });
        const member = s.members.find(m => m.active && m.model === retirement.model);
        if (!member) continue;
        member.history ??= []; member.history.push({ model: member.model, provider: member.provider, retiredAt: this.now(), reason: retirement.reason });
        member.generation++; member.sessionId = null; member.calls = 0;
        if (retirement.replacement) { Object.assign(member, retirement.replacement); s.replacementPool = s.replacementPool.filter(m => m.model !== retirement.replacement.model); }
        else member.active = false;
      }
      for(const [actor,replacement]of Object.entries(s.meeting.replacements??{})) {
        const member=s.members.find(m=>m.id===actor);member.history??=[];member.history.push({model:member.model,provider:member.provider,replacedAt:this.now(),reason:replacement.reason});
        Object.assign(member,replacement.replacement,{active:true,suspended:false,generation:member.generation+1,sessionId:null,calls:0});
        s.replacementPool=s.replacementPool.filter(m=>m.model!==replacement.replacement.model);
      }
      s.failureArchive.push(...s.meeting.failures);
      for (const member of s.members) member.sessionId = null;
      s.secretarySessionId = null; s.runtime.requestCounts = {}; s.phase = 'RESEARCH';
      if (s.meeting.number >= s.rules.maxMeetings || s.projectCalls >= s.rules.maxProjectCalls) { s.pausedPhase = 'RESEARCH'; s.phase = 'PAUSED'; s.pausedAt = this.now(); s.pauseReason = 'Human-ratified project budget reached'; }
    });
  }
  setSession(actor, sessionId) {
    return this.change('runtime', 'session.bound', s => {
      if (actor === 'secretary') s.secretarySessionId = sessionId;
      else this.member(s, actor).sessionId = sessionId;
    });
  }
  chargeStep(actor, role, assignment = '') {
    return this.change(actor, 'model.call', s => {
      requireThat(!['PAUSED', 'STOPPED', 'COMPLETE'].includes(s.phase), 'Project is not running');
      requireThat(s.projectCalls < s.rules.maxProjectCalls, 'Project model-call budget exhausted; human revision required');
      const counts = s.runtime.requestCounts ??= {};
      const key = `${s.meeting.id}:${s.phase}:${role}:${actor}:${assignment}`;
      const limit = role === 'worker' && s.phase === 'RESEARCH' ? s.rules.callsPerInterval : 24;
      requireThat((counts[key] ?? 0) < limit, 'Phase call budget exhausted');
      if (role === 'worker' && s.phase === 'RESEARCH') {
        const m = this.member(s, actor);
        requireThat(m.calls < s.rules.callsPerInterval, 'Research call budget exhausted'); m.calls++;
      }
      counts[key] = (counts[key] ?? 0) + 1;
      s.projectCalls++;
    });
  }
  pause() { return this.change('human', 'project.paused', s => { requireThat(s && !['PAUSED', 'STOPPED', 'COMPLETE'].includes(s.phase), 'Project is not running'); s.pausedPhase = s.phase; s.pausedAt = this.now(); s.phase = 'PAUSED'; }); }
  resume() { return this.change('human', 'project.resumed', s => { this.phase(s, 'PAUSED'); if (s.meeting.deadline) s.meeting.deadline += this.now() - s.pausedAt; s.phase = s.pausedPhase; s.pausedPhase = null; }); }
  stop() { return this.change('human', 'project.stopped', s => { requireThat(s, 'No project'); s.phase = 'STOPPED'; }); }
  view(actor) {
    const s = this.state; if (!s) return null;
    if (actor === 'human') return s;
    if (actor !== 'secretary') this.member(s, actor);
    const result = structuredClone(s);
    delete result.runtime;
    result.members = result.members.map(({ sessionId, rejection, ...m }) => ({ ...m, ...(actor === m.id && rejection !== undefined ? { rejection } : {}) }));
    delete result.secretarySessionId;
    if (s.phase === 'RESEARCH') result.meeting = { number: s.meeting.number, id: s.meeting.id };
    if (s.phase === 'SUBMISSION') { result.meeting.submissions = actor === 'secretary' ? {} : { ...(s.meeting.submissions[actor] ? { [actor]: s.meeting.submissions[actor] } : {}) }; }
    if (s.phase === 'REVIEW') result.meeting.reviews = Object.fromEntries(Object.entries(s.meeting.reviews).filter(([, r]) => r.reviewer === actor));
    if (s.phase === 'REVIEW') result.audits = result.audits.filter(a => a.reviewer === actor);
    // Ongoing independent case assessments are hidden until the meeting's decisions freeze.
    if (['SUBMISSION', 'REVIEW', 'DISCUSSION'].includes(s.phase)) for (const c of result.cases) c.reviews = Object.fromEntries(Object.entries(c.reviews).filter(([, r]) => r.reviewer === actor));
    result.reviewerStats = this.reviewerStats(s.phase === 'REVIEW' ? { ...s, audits: s.audits.filter(a => a.meetingId !== s.meeting.id || a.reviewer === actor) } : s);
    result.publications = result.publications.slice(-3);
    return result;
  }
}
