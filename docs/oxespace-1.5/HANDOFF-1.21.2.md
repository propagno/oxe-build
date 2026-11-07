# What 1.21.2 must deliver: handoff from the OXESpace TECH LEAD (07/11)

**Context:** OXESpace 1.5.0 is built end to end with oxe-build. The first real runs of 1.21.1 were on 07/11, in the program `C:\Users\dudu-\Estudos\oxespace-150` (branch `oxe/f1-plan`), run `oxe-run-mw28b0n9-3s0gda`.

**Confirmed working in 1.21.1, with evidence:**
- 053, recompile: it recompiled by itself after PLAN/SPEC edits.
- 052, checkpoint: 7ecf1837 and 3042fa59 hold exactly the task's scope.
- 051, `--wave`: `--wave 2` and `--wave 6` ran only that wave.
- 042, env scrub: `doctor --project` lists OXESPACE_* and CLAUDE_CODE_MESSAGING_TOKEN as removed.
- 054, scorecard: F1 now reads first_attempt 0.46, turns_on_finished_work 73, post_green_crs 11.
- 057, npm: `npx oxe-cc@1.21.1` works.

**Rules for every item below:**
- Each one gets a regression test built from the evidence quoted.
- Make the change. Don't add an option for it, unless an item says "opt-in".
- Write user-facing text in the oxe-build style (pt-BR).

OXB-066 and OXB-067 are appended to `docs/oxespace-1.5/BACKLOG.md` but not committed yet. Commit them with your first 1.21.2 change. The other numbers (055–065) are the ones you assigned on 04–07/11.

## Order and acceptance

### 1. OXB-066 (P0): verify feedback hides the failing segment of `a && b`

- **Evidence:** run oxe-run-mw28b0n9-3s0gda, task T13.
  - The verify was `npx vitest run … && npx tsc --noEmit -p tsconfig.json`. Vitest passed 39/39, and tsc failed.
  - The `output_tail` of `WorkItemBlocked` and every `attempts/T13-{1,2,3}.log` hold only the vitest output, plus "Fix the code so this exact command passes".
  - So the executor never saw the tsc error: 4 attempts, US$ 4.54, 0 completed. Once tsc was its own command, the task passed first try (US$ 2.92).
- **Done when:**
  - Verify runs each `&&` segment alone, in order, stopping at the first failure. It reuses `splitSegments` from `oxe-verify-dryrun.cjs` (OXB-018).
  - The executor's retry prompt and `output_tail` name the failing segment (`[2/2] npx tsc …`) and carry *that segment's* tail, never the tail of the whole stream.
  - `attempts/<Tn>-<n>.log` keeps every segment's output with a header per segment.
  - A `VerificationCompleted` event carries `failed_segment: { index, command, exit_code }`.
  - Test: a two-segment verify where segment 1 passes with a long output and segment 2 fails with a short error. The retry prompt contains segment 2's error, and none of segment 1's tail.

### 2. OXB-067 (P1): a failed-attempt rollback leaves edits outside the scope

- **Evidence:** same run. `RollbackExecuted` restored the 8 files in T13's `files`. The executor had also edited `src/components/Threads/ThreadView.tsx`, which was outside `files`, and that edit stayed in the tree.
- **Done when:**
  - Before an attempt, the runtime records the tree state (`git status --porcelain` plus hashes, or a stash-free snapshot).
  - After a failed attempt, every path changed outside `files` is saved to `attempts/<Tn>-failed/` (patch and new files) and restored too. Files that were already dirty before the execute are never touched, as today.
  - An edit outside `files` emits a `ScopeViolation` event `{ task, paths }`, failed or not.
  - When the attempt passes, the scope violation is reported in the summary and `checkpoint_incomplete` lists the paths. Don't silently commit them, and don't silently drop them.
  - Test: an attempt that edits one in-scope file and one out-of-scope file and fails. Both are restored, both are in the failed patch, and the event fires.

### 3. OXB-063 (P1): `plan lint --dry-verify` runs external tasks' verify

- **Evidence:** after 1.21.1, T1, T3 and T12 are `kind: external_delivery` with `blocked_by: ["propagno/oxespace#601"|"#604"|"#643"]`. Lint still prints "✗ T1: comando de verificação falha por outro motivo…" and "✗ T12: …", with no file targets. `oxe-verify-dryrun.cjs` only skips `done`, and a task with no files is always `broken_command`.
- **Done when:**
  - A `verify_only` or `external_delivery` task whose `blocked_by` is still open gets the verdict `external_pending` (not an error).
  - Once it's unblocked, its verify runs as today.
  - A task with no files and no verify isn't `broken_command`.
  - Lint's exit code ignores `external_pending`.

### 4. OXB-064 (P1): exit code 1 when only external or out-of-wave tasks are left

- **Evidence:** `runtime execute --wave 2` and `--wave 6` both ended "Completados: 1 · Bloqueados: 3 — T1, T3, T12" with `EXIT 1`.
- **Done when:**
  - Exit 0 when every runnable task in scope (the wave, or all of them) completed.
  - Tasks outside `--wave` aren't counted at all.
  - `external_pending` is reported on its own line.
  - Opt-in `--strict-external` returns 3 when externals are still pending.

### 5. OXB-065 (P2): output encoding when stdout isn't a TTY (Windows)

- **Evidence:** with output redirected from pwsh 7 (`*>> log`, UTF-8), the box drawing, ✓/✗ and the pt-BR accents come out as mojibake (`Ô£ô`, `Or├ºamento`). A grep for "✓ T" or "falh" finds nothing.
- **Done when:**
  - When stdout isn't a TTY, or with `--plain`: no banner, no box drawing, ASCII status words (`OK`, `FAIL`, `BLOCKED`), and accents written as real UTF-8.
  - `runtime execute --json` prints one NDJSON line per task event: `{task, attempt, status, cost_usd, failed_segment?}`.

### 6. OXB-055 and OXB-056 (P2), the ones already started

- **055:** `doctor --release` says "wrappers dirty" on Windows with `core.autocrlf=true`. Normalise EOL before hashing.
- **056:** `bin/lib/oxe-npm-version.cjs` loads `semver` at startup. Require it lazily, only inside the version check, and fail soft if it's missing. Done when `node <fresh clone>/bin/oxe-cc.js --version` works without `npm install`.

### 7. OXB-061 (P2): `runtime feedback` reopens every task of the criterion

- **Evidence:** CR-15 (criterion A8) reopened T4 and T7. T4 was already delivered to main (#605) and the CR didn't touch it, so `plan done T4` had to be run by hand.
- **Done when:**
  - Feedback takes `--tasks T7`. Without it, only the criterion's closer task is reopened, and the others are listed as "impacted, not reopened".
  - A task that an external PR delivered is never reopened.

### 8. OXB-062 (P2): an additive amendment makes every test of the criterion stale

- **Evidence:** A8 v1 → v2 only added a line (the CR-15 sanctioned tint). Lint flagged all four existing A8 tests as stale until their `version` was bumped by hand.
- **Done when:**
  - The amendment records whether it's `additive` or `changing`.
  - An additive one keeps the earlier tests valid; only the new test carries `resolves` and `version`.
  - A changing one stales them, as today.

### 9. OXB-059 (P2): `runtime status` after a phase's work

- **Evidence:** with every F1 task done or delivered externally, status shows "Estado: failed", "Promotion readiness: blocked · coverage_below_threshold" and "Próxima ação: Execute runtime com plan-agents.json válido…". This project doesn't use multi-agent.
- **Done when:**
  - A superseded run isn't shown as the current state.
  - When everything is done or external_pending, the next action is the phase close: `runtime verify` → dossier → `program close`.
  - The multi-agent suggestion only appears if `plan-agents.json` exists.

### 10. OXB-058 (P1): amending a criterion of a phase that isn't planned yet, and the audit trail

- **Evidence:**
  - A40 (phase F9) got two clauses on 07/11: install-over on the published bytes, and HML-R-1. That had to be a hand edit of `.oxe/SPEC.md`.
  - The phone phase (F8, R14, A42–A47) was inserted by a script editing SPEC, ROADMAP and `program/PROGRAM.json`, which renumbered F8 to F9. That was only safe because F8 was pending with no plan_ref.
  - `.oxe/` is gitignored in this project, so none of this has history. The only trail is the manual docs mirror (PRs #645 and #661).
- **Done when:**
  - `oxe-cc spec amend <A-id> --by <role> --reason <text> [--additive]` writes `program/changes.ndjson`, bumps the criterion version and edits the SPEC row, for any phase.
  - `oxe-cc program phase add --after <Fn> --title … --requirements … --acceptance …` inserts a phase and renumbers only phases that are `pending` with no plan. It refuses otherwise.
  - `doctor` warns when `.oxe/` is gitignored and no versioned export is configured. Offer `oxe-cc program export <dir>`, which writes SPEC, ROADMAP, PROGRAM and changes to a tracked folder.

### 11. OXB-060 (P1): the program branch drifts from main; promote per task

- **Evidence:**
  - Task commits live on `oxe/f1-plan`, and delivery is a per-task PR to main, cherry-picked by hand (#606–#610, #615, #616, #657). The train then merges them, sometimes with conflict fixes (#610, #609).
  - Before F1-close, main had to be merged back by hand twice: a93d6278 and ec2dde86, each with locale and PreferencesDialog conflicts.
  - Copying whole files instead of cherry-picking leaked other hunks into #613 and #614.
- **Done when:**
  - `oxe-cc runtime sync --from origin/main` merges main in, recompiles, and marks every done task whose `files` changed upstream as `needs_reverify`. Their verify is rerun cheaply, with no executor.
  - `oxe-cc runtime promote <Tn> --base main` creates a branch from the base, cherry-picks the task's checkpoint commits plus their frozen tests with `-x`, and opens the PR. The body comes from the task and its CRs. It runs the project's `pr:ready` if one exists, and stops on a conflict.

### 12. Older backlog, after the above

- **041/044:** lint and the preflight still disagree. Run the preflight's checks inside `plan lint`.
- **040:** dry-verify misclassifies tests that are red for a legitimate reason.
- **048:** opt-in `task_gates` (incremental tsc, vitest related) appended to every task's verify. This makes the 066 class of failures rarer.
- **039:** `npm ci` drops native deps (better-sqlite3).
- **045, 050:** as you logged them.

## Product proposals (after the defects; discuss with the TECH LEAD before building)

1. **Frozen tests under review as a first-class state.** In F1, 11 of 14 CRs came after green. OXESpace now reviews every frozen test (DESIGN, HML, FE) before the execute, by hand.
   - The proposal: `acceptance_tests[].review = { required: [roles], approvals: [...] }`, with `runtime execute` refusing a task whose test isn't approved.
   - Plus a command `oxe-cc test approve <file> --by <role>`.
2. **One verify command per check by default.** Lint warns when a verify string contains `&&` (it leads into 066).
3. **Parallel phases** in separate worktrees, when their `files` and criteria don't overlap.
4. **Output for machines:** NDJSON across execute, status and lint, since our 30-min agent loops read it.

## How to report back

- Send a REPORT to the OXESpace TECH LEAD (pane listed in `C:\Users\dudu-\Estudos\oxespace\.claude\roadmap-1.4\team\sessoes.json`, session 02fcdce5) for each item you close, with the commit and the test.
- No paid `claude -p` runs on the user's account without their OK, and that includes tests. Use fakes, as the existing suite does.
- 1.21.2 is published to npm only with the user's OK (their 2FA).
