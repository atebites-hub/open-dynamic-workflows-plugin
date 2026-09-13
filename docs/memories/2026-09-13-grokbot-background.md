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
- state: in_progress
- started: 2026-09-13

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
