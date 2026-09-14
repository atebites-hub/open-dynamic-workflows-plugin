# Grok Bot MCP deadline repair

Linear: BLA-744
Issue: https://github.com/atebites-hub/open-dynamic-workflows-plugin/issues/24

## Description
- Implement the approved asynchronous start/status/cancel adapter and retain
  partial CLI traces without changing the execution engine or selected models.

## Task (TCREI)
- **Task**: Fix the reproduced 60005 ms Grok Bot request cancellation.
- **Scope**: inline
- **Context**: src/mcp/server.ts; core src/executor/subprocess.ts; Factory host policy in project-factory docs/agents/reference/plugin_pins.md.
- **Rules**: Preserve other hosts, native Claude/Codex exclusions, credentials and worktrees. No new dependencies or false live PASS.
- **Evaluation**: verifiable; Gate: npm run verify. Additional long-duration and live VM checks qualify the specific host separately; strict Advisor remains inactive.
- **Plan**: docs/plans/2026-09-13-grokbot-background.md
- **Iteration**: Package/process fixtures first; actual >60-second VM run after release verification.

## Status
- state: completed
- started: 2026-09-13
- completed: 2026-09-14

## Lessons
### Key Challenges & Analysis
- Cause: A synchronous MCP request owns the abort controller and is cancelled by the host deadline.
- Risks: Detached work requires private durable ownership, bounded runtime, explicit cancellation and fail-closed completion.
- Alternatives: No supported host timeout override was found; changing the model or quota does not repair the transport lifecycle.

## Verification increment

- Red controls reproduced missing Grok Bot status/cancel tools and missing
  cancellation/timeout trace files before production edits.
- Plugin build/typecheck, 7 host tests, 8 installer tests, 50 smoke checks,
  three packaged worktree host fixtures and the background lifecycle check pass.
- All 175 core tests pass. The long packaged lifecycle check passed in 72.6s,
  including two 65-second fixture workers across MCP disconnect/reconnect.
- Background cancellation also checks the owned nested process is stopped;
  a CPU-bound script reaches the hard deadline. These are fake-model fixtures,
  not live Grok Bot attestation. Release publication and native VM QA remain.

## Published core

- Core PR #14 merged as cd5c3323579ba0f6393c0f545fddc249b5c95219.
- Rebuilt and reran the complete plugin verification against that published pin:
  all checks passed. Native Grok Bot acceptance remains pending.

## Native acceptance, not complete

- Plugin PR #25 merged as 2f487dc1abe06189f8a88987b0e5981e7540fd5f;
  verified published bundle SHA256 is
  598186591a37acd064ac2cfaf634cf6e30d53dadef5a765f7529f5d1b979a3a7.
- Installed through native Grok Bot connector replacement. The real long run
  run-mu00m9w4-f606c9 passed at 247685 ms with two complete CLI exits, separate
  retained worktrees, exact edits, unchanged parent and durable results.
- Cancellation run run-mu00xvrh-bf068b reached cancelled in 817 ms and retained
  its partial trace, but the host-managed shell and sleep remained alive.
  This is a blocking FAIL. Both exited naturally before cleanup; no kill was
  needed. PPID 23/sand-exit-watch was observed; PGID/SID were not recorded.
- Issue #24 remains open. Requested user approval to fix this newly exposed
  cleanup gap; status stays in_progress. No full-ready or strict Advisor claim.

## Approved cleanup repair, 2026-09-14

- Jay explicitly approved the cleanup fix and PR merges. Scope remains inline;
  Plan: docs/plans/2026-09-14-grokbot-cleanup.md. Status: in_progress.
- Native CLI 2026.09.10-fd3934a reproduces it: CLI PGID/SID 2898694,
  shell PGID/SID 2898969, sleep shares the shell group. A fresh harmless marker
  reached all three. SIGKILL of the CLI group left shell and sleep running.
- SIGINT-only comparison also left shell/sleep alive after five seconds. All
  diagnostic processes were selectively cleaned; sand-exit-watch was untouched.
- Fix belongs to the supervisor's shared terminal path, with a bounded Linux
  job-marker sweep and identity recheck. No credential or model changes. A
  terminal success cannot precede cleanup; tests include unrelated-process safety.

## Cleanup regression results

- The unchanged 0.4.2 bundle fails the detached-child process-death assertion on
  Linux. The 0.4.3 bundle passes it, plus normal exit, failed exit, timeout and
  same-cwd unrelated-control survival. A fresh container supplies git/procps only
  for test fixtures; they are not new plugin runtime dependencies.
- Complete plugin verification passes: build/typecheck, host and installer tests,
  50 smoke checks, three packaged worktree fixtures and the background lifecycle.
- No native 0.4.3 acceptance claim yet. Issue #24 remains open pending live rerun.

## Merge hold, 2026-09-14

- Cleanup PR #26, head 35d2a0e3f91f9373fb1d7938870cb134045ce38d, is NOT merged.
- CI run 34861352417 failed the multi-host startup test and then hung on open
  handles; the run was cancelled. The same suite passed in a fresh Linux
  container as UID 1001. The CI-only difference is not yet diagnosed.
- Bot prewarm verified version 0.4.3 and bundle SHA256
  5f67525e2745f4f3da51824b1eaf40f2058f8b0c7227af92b41df383378b1175.
  Its active connector remains 0.4.2; no native 0.4.3 rerun has occurred.
- Disclosed the new regression and asked Jay whether to fix it before further
  source changes. Status stays in_progress; issue #24 remains open.

## Approved CI regression repair

- Jay requested fixing the regression and merging #26. Scope remains inline.
- The real cleanup helper fails a controlled protected-process fixture with
  EACCES before it reaches the owned worker. Per-process access denials now leave
  the unclassified process untouched instead of failing unrelated job startup.
- Confirmed owned-process signal denial and /proc enumeration failure remain
  blocking. Three focused checks cover these distinctions. Host-test subprocess
  teardown is unconditional and bounded so future assertion failures report fully.
- Complete local verification passes after the repair. Current-head CI and merge
  remain required; this is not native Bot acceptance or strict Advisor evidence.

## Native acceptance completed

- PR #26 merged as 1a42223c7709941a10599a72b6d03c59bbccca24 with passing CI.
  The native Bot connector was upgraded to that exact checksum-verified 0.4.3
  bundle, not the earlier same-version prewarm.
- Cancellation run run-mu1ip8n8-38fab0 passed: CLI and detached shell/sleep gone,
  no manual worker kills, unmarked same-worktree control survived, partial trace
  retained and parent unchanged.
- Long run run-mu1iu7lq-360323 passed in 97607 ms: two real Cursor workers, distinct
  sessions/worktrees, exit zero, exact edits, no failed agents/workflows, durable
  receipts and completed cleanup.
- A host status-poll timeout did not stop the job. A read-only retry recovered
  its result. The host error's claimed 840-second duration is not independently
  measured; the reconciled report correctly records duration as unknown.
- Evidence: docs/evidence/grokbot-043-native-acceptance-2026-09-14.md.
  Scope remains these Grok Bot ODW fixtures, not all Factory harnesses/plugins
  or strict Advisor. Issue #24 was already owner-closed before the live rerun.
