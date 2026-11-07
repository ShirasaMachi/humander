# humander

A DeepSeek Harness plugin for a human-led research organization. Workers independently investigate a ratified problem, open meetings themselves, submit exactly one paper each, review evidence, inspect the secretary's bulletin, and continue or restart after publication.

This is a working protocol prototype, not a claim of autonomous scientific competence. Research publications use the project-selected English or Chinese language. The design paper is in `papers/`.

## Requirements and installation

- Node.js 24+, DeepSeek Harness **0.2.2-rc.1** (the tested version).
- Linux with usable Bubblewrap user namespaces, `/usr/bin/python3` or other required tools under `/usr`, and `pdfinfo`. Native Windows can install the package but cannot execute the Linux-only experiment sandbox in this release; run DSH and Humander inside WSL2 for the complete workflow.
- Tectonic with a prepared dependency cache. Compilation is offline (`--only-cached`).
- Configured Harness model providers. The default three independent reviews per paper require at least four distinct model IDs; model identity is supplied by the human, not independently inferred from API aliases.

Install into the DSH profile that serves your browser UI. On another machine,
clone the repository and build the installable archive locally:

```sh
git clone https://github.com/ShirasaMachi/humander.git
cd humander
npm pack --ignore-scripts
dsh plugin --profile web add "$PWD/dsh-humander-0.4.1.tgz"
```

Replace `web` with the name of your actual browser-serving profile. Restart that
DSH instance after installation. For development, the last command may add the
absolute source directory instead. Each DSH installation needs its own install
and its own private state directory. Back up the state directory before upgrades;
installing a newer archive alone does not migrate another machine's data.

The tested archive installation reports missing peer packages in the profile's package-manager check; Harness supplies these through its host module resolver, and the installed archive starts successfully. Launch it through Harness rather than importing the installed profile package in a standalone Node process.

In `~/.dsh/profiles/web/cordis.patch.yml`, add or update the `humander` entry.
Keep the other entries in that file. Use paths that exist on that machine:

```yaml
- id: humander
  config:
    stateDir: /absolute/private/path/humander-state
    port: 3088
    autoRun: false
    publicBaseUrl: ''
    tectonic: /absolute/path/to/tectonic
    texCache: /absolute/path/to/tex-cache
    bwrap: /usr/bin/bwrap
```

The configuration supplies the whole plugin configuration object. Preserve these fields when adding a command-line patch. An empty `stateDir` installs the plugin without starting an organization.

```sh
dsh --profile web --no-open
```

The Humander panel listens only on `127.0.0.1:3088`, independently of the DSH
web port. On the host, open that URL and enter the token in
`stateDir/operator.token`. From another computer, use an SSH tunnel such as
`ssh -L 3088:127.0.0.1:3088 your-dsh-host`, then open
`http://127.0.0.1:3088` locally. Keep the token private. To use the native
Humander sidebar in a remotely hosted DSH page, see the authenticated gateway
integration below; installing the package does not create a public panel route.

## Running a project

1. In **Team and models**, set the worker count, choose each worker's provider and model, and choose the secretary model separately. Select from the live Harness catalog or enter an exact model ID. **Save configuration** persists the team without starting research. Enter the original request and select **Start requirement meeting** when ready.
2. Use **Run one phase** to let workers discuss the request, the secretary draft the definition, and every worker inspect it. Read the proposed interpretation, scope, numbered questions and acceptance/stopping conditions. **Return definition for revision** records a human clarification in the meeting and requires a new draft and inspections. **Confirm displayed definition** ratifies that exact version.
3. Workers record research commitments, inspect the initial bulletin, and publish it. No research submission is required before this first definition meeting has established a research problem.
4. **Continue autonomously** advances the already-defined protocol. Any worker's meeting call opens the submission window. Every worker must submit exactly one paper of its own work, including code and executed experimental evidence. Useful failures are eligible. Missing submissions become submission failures at the deadline.
5. Initial reviews remain hidden from other workers. Authors respond once; reviewers may update once. Quality and capacity decisions, next commitments and failure experience enter the bulletin. Workers inspect every new secretary draft. Publication precedes context resets.

Pause and stop are human controls. Workers cannot invoke them or ratify goals through their tools. There is no model chair. A small runtime timer advances open phases and checks deadlines; it does not select research directions or decide to hold meetings.

### Team configuration

The form supports 2–12 workers, editable worker IDs, and one independent secretary session. The secretary may share a worker's model or use a completely different configured provider/model. It never counts toward the worker or review totals. The configured secretary route is used explicitly; if that model is retired, the runtime pauses its obligation instead of silently choosing another worker's model.

Worker count, review count, acceptance capacity, reviewer turnover and meeting/call budgets are form controls. Advanced protocol settings remain available in a single JSON field. With `minReviews = 3`, at least four distinct worker model IDs are required. Multiple workers may share a model only if enough other distinct models remain for independent reviews. Model aliases are not independently verified as distinct underlying systems.

Saved configuration lives in the existing SQLite database and survives reloads and service restarts. Saving does not open a meeting or generate model output. Provider/model route validation checks Harness metadata, not whether an external provider will accept a future inference request.

Before initial goal ratification, **Apply team changes** can resize or reconfigure the initial roster. It records the human change, closes prior sessions, invalidates the draft and inspections, and requires fresh requirement discussion. After goal ratification, the roster size is fixed; use the existing meeting replacement controls for worker model changes. **Apply secretary model** is available separately on an active project, requires a reason, and clears the previous secretary session. This release supports one secretary, preserving the single accountable summary role supervised by all workers.

### Chinese and English

The human panel has a **中文 / English** interface selector. It follows the browser language on first visit and remembers the operator's choice locally. This setting changes presentation only.

Each new project has a separate **Research publication language** selector. The selection is saved with the team configuration and enters the ratified problem definition. Workers, reviewers and the secretary receive an explicit instruction to write their natural-language meeting statements, papers, reviews, commitments and bulletins in the selected language. JSON keys, code identifiers, citations and experimental outputs remain exact. Existing projects without a language field continue in English. Before the first goal ratification, changing the team's research language records the human change and restarts requirement discussion. Once ratified, the language remains fixed for the project.

The ACL PDF generator supports both languages and preserves the original human request verbatim. Chinese text uses the local **Noto Serif CJK SC** font with the existing offline Tectonic cache. Chinese titles, abstracts, section headings and body text are embedded as selectable Unicode. This is a host font dependency for Chinese publications; missing fonts or failed compilation block publication rather than emitting an unreadable PDF. Paper length remains limited to ten rendered pages.

### Open experimental releases

Before research submissions, configure `publicBaseUrl` to a publicly reachable origin that proxies only the plugin's `/releases/` route. Never expose the operator token or management API as part of that route. Empty configuration deliberately blocks submission eligibility. Loopback is suitable for integration tests, not a claim of an Internet-public release.

The plugin freezes the actual experiment input code, output files, command, exit status, timing and output. It generates an ACL-format paper and SHA-256 manifest, then retrieves and verifies the manifest and every released file through the configured public URL. Version 0.2 supports explicit MIT-licensed releases. The operator is responsible for having rights to release submitted material and for keeping the configured public origin available.

Papers have structured sections: `abstract`, `introduction`, `relatedWork`, `method`, `results`, `discussion`, `limitations`, `references`. Text is escaped before TeX compilation; the rendered PDF must have at most ten pages. No generated result is silently substituted for an executed experiment. This version does not accept arbitrary LaTeX, custom figures, private datasets or alternate license workflows.

## Harness sidebar and authenticated gateway

Version 0.4.1 registers a **Humander** sidebar panel through Harness's native client plugin slots. Install into the profile serving the interface you actually use (`web` for `dsh web`). The sidebar expects an authenticated `humander/` child path under the app mount, for example `/dsh/humander/`. DSH does not create that route automatically. If the route is missing, the sidebar now explains how to open the local panel or integrate an authenticated gateway instead of showing a blank page. Do not run two plugin instances against the same `stateDir`.

The deployment gateway imports `forwardPanel` from `src/gateway.js` and calls it **only after validating its operator login session**, for requests to the mount or its descendants. Pass `{ mount: '/dsh/humander', port: 3088, tokenPath: '/absolute/state/operator.token', secure: true }`. The gateway retains the operator token on the server, allows same-origin embedding, and requires same-origin JSON for mutations. The panel uses relative API URLs and connects automatically behind this gateway. Direct loopback access still requires the operator token. This adapter assumes that authenticated gateway users are trusted human operators.

Public research releases need their own explicitly configured public URL; the authenticated management route is not a public release endpoint.

## Enforcement and storage

- Protocol state and events use one SQLite database; failed commands roll back.
- Workers receive scoped `humander_*` tools. Inherited shell, plugin-manager, cross-session and subagent tools are excluded and guarded.
- Workers can write only their own `src/`, `experiments/` and temporary `scratch/` files. Extra prose documents go through the three publication categories rather than ad hoc files.
- Experiments use Bubblewrap with no network, host home or daemon socket; input code is separately mounted read-only. There is no unsandboxed fallback. Runtime/output limits and retained-artifact budgets apply. This is not a defense against kernel vulnerabilities or a complete filesystem quota implementation.
- Independent reviewers can rerun assigned frozen experiments in fresh sandboxes, with a concrete question and at most two reruns per reviewer per experiment. Matching output is evidence of reproducibility, not proof of scientific correctness.
- Model request counts persist across restarts. Research uses the configured interval budget; other roles have a maximum of 24 requests per actor, phase and assigned paper.
- A missing sandbox, compiler, public release endpoint or sufficient evidence blocks the affected action and appears in the human panel.
- The secretary has only state/evidence reads and draft tools. It cannot approve goals, choose authors' commitments or score submissions.
- Default quality thresholds are median soundness ≥3 and overall ≥3.5. The default capacity is half the meeting's worker count, rounded down. Boundary ties, insufficient independent reviews and unresolved correctness objections remain pending.
- Rejection closes the old instance only after publication; its new generation gets a new session and workspace. Its own rejected submission and reviews remain available. Accepted workers keep their session. The secretary starts afresh after each publication.
- Provider credentials and operator controls remain outside experiment mounts. The host itself and operators with filesystem access remain trusted.

Only the Problem Definition Paper, Research Papers and Meeting Reviews are organizational prose classes. Reviews, inspections and commitments are structured records. Temporary work and session logs are not added to shared research memory.

## Governance and recovery

The panel exposes these controls; none is delegated to the secretary.

- **Goal amendments:** a human amendment opens or joins a research meeting, which still requires every worker's paper. After review, every available worker discusses the amendment in a new definition round. The secretary drafts it, workers inspect it, and the human confirms interpretation and acceptance conditions. The original problem and every ratified version remain available. Old submissions and appeals retain their original definition and selection settings. Cancelling an amendment preserves the old definition.
- **Acceptance contracts:** each check names its question, observable outcome, evaluation setting, method, checker, pass criterion and handling of failure. Workers report evidence in a meeting. Only the human completes a project, separately choosing deliverable adoption, demonstrated infeasibility or inconclusive completion. Adoption requires a recorded pass for each current check; a paper's acceptance never completes the project automatically.
- **Appeals and pending decisions:** pending papers enter a persistent docket. An author can attach one evidence-based appeal to a rejected or pending frozen version during a later meeting. Independent case reviewers reexamine the original version. The original quality gate and batch capacity apply; ordinary outcomes are computed automatically and boundary ties remain explicit human decisions. Case assessments are attached records, not new papers, and do not waive the meeting's mandatory new submission. Resolutions take effect only after the checked bulletin. A deferred rejection resets an instance only if it is still the original model and generation.
- **Corrections and retractions:** any worker can open an evidence-based correction case for accepted work. Independent reexamination informs the human's retain/retract decision. The original publication remains immutable and linked to the later decision; retracted work leaves the accepted bibliography. A later research submission can identify its own prior release with `supersedes`, retaining the paper identity with an incremented version.
- **Reviewer accountability:** each review includes explicit factual claims about its assigned frozen experiment records. The host checks claimed exit codes, output, timeout status, commands and source hashes against those exact records, preserving initial and corrected assessments. Subjective importance and agreement with other reviewers are not correctness targets. Humans may additionally record evidenced fabrication, material misreading, factual scoring errors, refusal to correct, or missed defects within a declared inspection scope. Every finding can be contested; unresolved contests prevent automatic removal of that model. Human adjudication records independent evidence.
- **Model-seat turnover:** the default ceiling is 15%, configurable between 10% and 20%, accumulated over model/meeting observations with sufficient audited reviews. Defaults require at least three audited reviews, at least two erroneous reviews and an error rate of at least 50%. The ceiling is not a forced removal quota. Repeatedly contradicted models are ranked by evidenced error rate and error count. A model's ledger survives context resets. Retirement and replacement happen after publication; only the human's ordered eligible pool supplies replacements. Without a replacement, the seat remains visibly vacant and papers missing enough reliable reviews remain pending. Retired model IDs cannot reenter under a new session.
- **Unavailable members:** the human can retry an obligation, extend a meeting window, exclude an unavailable participant, reinstate a suspended worker, fill a vacant seat from the eligible pool, move the secretary role to an available worker's configured model, repair an invalid model route before research, or queue an explicit pool-based worker replacement for the next publication boundary. Exclusion invalidates any prior bulletin inspection round, remains in the published record, and never invents approval or a missing submission. Review history survives retries and reinstatement.
- **Bounded continuation:** the human confirms request and meeting budgets with the definition. Research intervals have separate per-worker limits. Extensions are explicit human records. Automatic continuation is persisted across restarts, but an unconfirmed definition never becomes a research instruction. The host advances declared phases and deterministic review rotation; it does not choose investigations or initiate research meetings itself.

### Default settings

These settings are editable when opening a project and, subsequently, through a human-ratified amendment. Emergency call grants and window extensions are separately recorded human interventions.

| Setting | Default | Meaning |
| --- | --- | --- |
| `minReviews` | 3 | Distinct non-author models; deterministic rotating assignments |
| `acceptanceRate` | 0.5 | Quality gate first, then original meeting capacity |
| `reviewerTurnover` | 0.15 | Maximum accumulated model-seat turnover |
| `minAuditedReviews` / `minErrorReviews` | 3 / 2 | Minimum evidence for automatic retirement consideration |
| `submissionMs` / `reviewMs` / `inspectionMs` | 300000 | Meeting windows; missing inspections never imply approval |
| `discussionMs` | 180000 | Declared discussion window; unresolved obligations remain visible |
| `callsPerInterval` | 30 | Per-worker research model-request limit |
| `maxProjectCalls` / `maxMeetings` | 2000 / 20 | Overall stopping limits |
| `experimentSeconds` | 60 | Wall-clock limit for one sandboxed execution |
| `maxWorkspaceBytes` | 50000000 | Retained workspace/artifact budget |

### Memory, publication and storage

Model-facing state is a compact index. Exact definitions, reviews, audit evidence, rejected-paper feedback and older meeting records are retrieved in bounded chunks with `humander_read_record`; the bibliography uses `humander_library`. Preview text is labeled and cannot replace inspection of the exact underlying record. Human controls always address the full draft hash. The human can download the same published PDFs and attached evidence records from the panel.

Only the three publication classes are retained as organizational prose. Decisions, appeals, audits and acceptance observations are structured attachments to those publications. Actual reproduction receipts are attached to the meeting record before temporary reproduction workspaces are removed. Rejected or retired instances' old private code and unsubmitted experiments are removed after publication; frozen submitted evidence stays accessible. Scratch output is never included in a research release. File-purpose links connect retained input code to a ratified question. Experiment output is checked for file count, byte budget and extra prose files. Harness session logs remain operator-owned audit data and are not exposed as model memory.

State migration from 0.1 is additive. Existing definitions, papers and historical bulletins are preserved. An older definition without structured acceptance checks must be amended before deliverable adoption. Installed archives use distinct versions so package-manager caches cannot silently reuse an earlier build.

## Operating boundaries

One organization runs per private state directory. This release targets Linux, the tested Harness version, offline ACL typesetting, explicitly MIT-licensed public experimental releases, and configured provider routes. Arbitrary LaTeX, private essential datasets and arbitrary Internet/shell access are intentionally outside the worker tool surface. They are not required to operate the defined meeting protocol.

Scientific independence, originality, chosen-language compliance, faithful summaries and experiment adequacy require substantive review; schemas and exact-record audits do not establish them. Provider aliases cannot prove distinct underlying model identities. Matching reproduction output does not prove a scientific claim. Long-term research quality and human-attention savings require empirical evaluation. The plugin does not install models, select provider accounts or fabricate missing evidence.

## Verification

Run these commands from the source checkout, which contains the two test files; the installable archive contains only the runtime, ACL style, installation patch and package documentation.

```sh
npm test
HUMANDER_TECTONIC=/path/to/tectonic \
HUMANDER_TEX_CACHE=/path/to/cache npm test

# Complete integration against the real Harness and sandbox:
HUMANDER_DSH_BIN=/absolute/path/to/dsh \
HUMANDER_TECTONIC=/path/to/tectonic \
HUMANDER_TEX_CACHE=/path/to/cache npm test
```

The two test files cover mandatory submissions, confidentiality, stale versions, exact publication barriers, amendments, unavailable inspectors, cross-meeting appeals, retractions, reviewer turnover, recovery budgets, isolation and real ACL compilation. The real-Harness integration runs three research meetings with sandboxed experiments, factual audits, a replacement model, historical case reviews, an actual process restart and human adoption. Its deterministic adapter validates protocol behavior rather than scientific judgment.

The third-party ACL style in `templates/acl.sty` retains its original notices. humander source is MIT-licensed.
