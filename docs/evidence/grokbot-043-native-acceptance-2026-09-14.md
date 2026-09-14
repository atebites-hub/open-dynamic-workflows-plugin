# Grok Bot ODW 0.4.3 native acceptance

Date: 2026-09-14. Tracking: BLA-744 / [issue #24](https://github.com/atebites-hub/open-dynamic-workflows-plugin/issues/24).

## Outcome and scope

- The existing `user-open-dynamic-workflows` connector was upgraded to the
  merged 0.4.3 build and reported connected with three tools.
- Native cancellation: PASS. The CLI and its detached shell/sleep stopped;
  an unrelated, unmarked process in the same worktree survived.
- Native long run: PASS. Two real Cursor workers completed in separate
  worktrees, with exact edits, distinct sessions, exit-zero traces and durable
  receipts. Core duration was 97,607 ms.
- One host status-poll timeout occurred. The accepted job survived and its
  completed result was recovered without resubmission. This is not a claim
  that every transport request succeeded.
- This qualifies these Grok Bot ODW lifecycle fixtures only, not every Factory
  plugin/harness, cloud surface, or strict Advisor routing.

## Installed release

- [PR #26](https://github.com/atebites-hub/open-dynamic-workflows-plugin/pull/26)
  merged as `1a42223c7709941a10599a72b6d03c59bbccca24`.
- Published and VM-cached bundle SHA256:
  `b2e6db2a3c60c5fae426279c077f488d37aa9c4a28f3579fdd9497857df4f974`.
- Executed cache path:
  `/home/box/.cache/odw/1a42223c7709941a10599a72b6d03c59bbccca24/server.mjs`.
- Connector: `user-open-dynamic-workflows`; `ODW_HOST=grok-bot`;
  `workflow`, `workflow_status`, `workflow_cancel`.
- Configured account/model/effort/default executor were preserved. Both
  completed workers reported `Auto Balance`; no fixed-model or strict tuple
  attestation is inferred from that label.
- The earlier `35d2a0e` prewarm is NOT the installed build, despite sharing
  the unreleased 0.4.3 version string.

## Cancellation fixture

Fixture: `/workspace/odw-cancel-live-043-20260914.IQ9Rcy`.
Job: `req-e874f174476b2f4f06b760def82b9af74660bae72f710fc04a0b6156ca610629`.
Run: `run-mu1ip8n8-38fab0`.

Native terminal response: `state=cancelled`, `terminal=true`, `ok=false`,
`cleanup.complete=true`, method `process-group-and-linux-job-marker`.
The intentionally aborted worker is recorded as a failed agent, not relabelled
as a successfully completed worker. The cancellation TEST passes.

Pre-cancellation process snapshot at `2026-09-14T17:30:42.680Z`:

| Process | PID | PPID | PGID | SID | Starttime |
| --- | --- | --- | --- | --- | --- |
| Cursor CLI | 2936180 | 2936162 | 2936162 | 2936162 | 59946116 |
| Shell | 2936713 | 2936180 | 2936713 | 2936713 | 59948825 |
| sleep 180 | 2936727 | 2936713 | 2936713 | 2936713 | 59948829 |

All three were gone after cancellation and remained gone at the two-second
recheck. `manualWorkerKills=0`. Unmarked control PID `2937078` (`sleep 300`)
survived in the same worktree and was cleaned only after those assertions.
Supervisor PID `2936151` was observed using the merged cache.

Worktree:
`/workspace/odw-cancel-live-043-20260914.IQ9Rcy/.odw/worktrees/run-mu1ip8n8-38fab0-agent-1`.
Parent `shared.txt` remained `base\n` (hex `626173650a`); the worker retained
`cancel-043\n` (hex `63616e63656c2d3034330a`). No parent PID marker appeared.

The retained partial trace records `/home/box/.local/bin/cursor-agent`,
`isError=true`, `resultSubtype=aborted`, `exitCode=null`, native events,
session `849cde8e-6cee-4146-9a3d-61f704e13695`, model `Auto Balance`, and
worker duration `124905` ms. That is total worker duration, not a measured
cancellation round-trip latency.

Report:
`/workspace/odw-cancel-live-043-20260914.IQ9Rcy/.odw/CANCEL-043-VERIFICATION.json`.
Trace:
`/workspace/odw-cancel-live-043-20260914.IQ9Rcy/.odw/grokbot-cancel-043/runs/run-mu1ip8n8-38fab0/agents/agent-1.jsonl`.

## Long-run fixture

Fixture: `/workspace/odw-background-live-043-20260914.0pQwyn`.
Job: `req-72e4f4bee751e1a27b0af8f8456f0dcf1eeb2f604bb83f434484457bd5009835`.
Run: `run-mu1iu7lq-360323`.

Created: `2026-09-14T17:33:08.903Z`.
Terminal receipt: `2026-09-14T17:34:46.614Z`.
Native result: `completed`, `terminal=true`, `ok=true`, `agentCount=2`,
`finishedAgents=2`, `failedAgents=0`, `failedWorkflows=0`, `durable=true`,
`cleanup.complete=true`. Core duration: `97607` ms.

| Worker | Native session | Exit | Duration (ms) | Retained shared.txt |
| --- | --- | --- | --- | --- |
| agent-1 | a9115f2a-12e6-46df-9bbb-e5cd6ac79b27 | 0 | 89495 | `background-043-one\n` |
| agent-2 | 1e15ae88-7963-4d0c-8af7-3b7b80a75e75 | 0 | 97561 | `background-043-two\n` |

Both traces name `/home/box/.local/bin/cursor-agent`, report `Auto Balance`,
and retain a successful `sleep 70` command. Parent `shared.txt` remained
`base\n`. No running fixture workers remained.

Worktrees are under the fixture's `.odw/worktrees/`, named
`run-mu1iu7lq-360323-agent-1` and `run-mu1iu7lq-360323-agent-2`.
Branches are `odw/run-mu1iu7lq-360323/agent-1` and
`odw/run-mu1iu7lq-360323/agent-2`.

Retained run directory:
`/workspace/odw-background-live-043-20260914.0pQwyn/.odw/grokbot-background-043/runs/run-mu1iu7lq-360323`.
It contains the journal, journal-status JSON, events, script and agent traces.
Report:
`/workspace/odw-background-live-043-20260914.0pQwyn/.odw/BACKGROUND-043-VERIFICATION.json`.
Reconciliation:
`/workspace/odw-background-live-043-20260914.0pQwyn/.odw/RECONCILIATION-043.json`.

## Transport timeout disclosure

A `workflow_status` request with `waitSeconds=20` returned this host error:

> Tool execution error. The CallDynamicTool tool call timed out after 840 seconds and was terminated. The execution environment may be unresponsive, or the operation needs longer than the per-call time limit.

The error text is preserved verbatim. Its numeric duration is NOT a verified
elapsed measurement: poll start/end timestamps were unavailable and it conflicts
with the visible job timeline. Reconciliation corrected `recordedDurationMs`,
`pollStartTimestamp` and `pollEndTimestamp` to null. The job completed independently;
a read-only status retry with `waitSeconds=5` recovered the terminal result at
`2026-09-14T17:36:54.510Z`. No workflow resubmission or worker retry was needed.

## Verification boundary

Factory QA executed the native tools and VM filesystem/process assertions, then
returned the stored JSON through the Grok Bot app. The Mac controller inspected
the returned terminal values, process identities, assertion fields, trace metadata
and exact file bytes, and independently verified the published bundle digest.
The VM filesystem is not mounted on the Mac. Reports/fixtures remain on the VM;
no credentials, complete environments or job-marker values were copied here.

Issue #24 was already owner-closed before this run. This record supplies the
previously missing native acceptance; it does not claim a new issue-close action.
