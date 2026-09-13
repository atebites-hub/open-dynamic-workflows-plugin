# Grok Bot background workflow implementation plan

Goal: complete ODW jobs beyond Grok Bot's 60-second MCP request deadline.
Design: approved in the task conversation. Reuse the existing workflow engine;
the Grok Bot MCP call accepts a durable background job instead of awaiting it.
Scope: inline implementation, not delegated work. No new dependencies.

1. Add packaged-process regression coverage for short acceptance, request
   cancellation/disconnection, reconnect, idempotent submission, failed nodes,
   explicit cancellation, retained traces and a hard run deadline.
2. Add a detached supervisor with private per-project job files. Its runtime
   child owns one process group; cancellation first uses the existing abort
   path, then group termination after a bounded cleanup grace period.
3. Add workflow_status and workflow_cancel only for Grok Bot. Preserve the
   synchronous workflow result on other hosts and native-only exclusions.
4. Retain partial subprocess traces on cancellation/timeouts in core, and
   support host-owned inherited process groups without changing defaults.
5. Update host fixtures, shared instructions and 0.4.2 release metadata; rebuild
   generated packages. Verify core and plugin gates plus a >60-second fixture.
6. Publish reviewed changes, refresh the exact pinned VM bundle, then perform
   the real native Grok Bot long-run and cancellation checks before a live PASS.

Files: src/mcp/server.ts; new src/mcp/background.ts;
scripts/background.test.mjs; src/mcp/host.test.ts;
scripts/worktree-smoke.mjs; scripts/smoke.mjs; README.md;
skills/open-dynamic-workflows/SKILL.md; release manifests/lock;
generated bundles/packages. Core: src/types.ts,
src/executor/subprocess.ts and src/executor/subprocess.test.ts.

Acceptance: no model/auth/effort override; accepted is not completed;
zero failed nodes and durable journals required for successful terminal status;
all stop paths retain evidence, reject unknown handles and never kill a PID
supplied by a client. Workers stay bounded after the MCP connection closes.
Status polling is capped below the host deadline; request cancellation after
acceptance is not an explicit workflow cancellation.
