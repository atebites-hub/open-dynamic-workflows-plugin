# Background job lifecycle

src/mcp/background.ts owns the Grok Bot start/status/cancel protocol and its
separate supervisor. All terminal paths terminate the owned runtime process group.
On Linux, a fresh runtime-only ODW_JOB_PROCESS_TOKEN also identifies detached
Cursor Shell sessions after reparenting. Cleanup matches UID and the exact marker,
then rechecks process starttime before signalling individual PIDs. No environment
contents or marker values are persisted. This is lifecycle cleanup, not a sandbox.

Status includes cleanup.method and cleanup.complete. The terminal receipt follows
cleanup. A protected process whose marker cannot be read is not proven job-owned:
it is skipped, never signalled. Cleanup covers identifiable job-marked processes,
not machine-wide visibility. Failure to enumerate /proc, signal a confirmed owned
process, or stop remaining marked processes still fails closed as
interrupted/ok=false. Other POSIX hosts retain process-group-only cleanup
and are not thereby qualified for detached Shell sessions. Fixtures live in
scripts/background.test.mjs; native acceptance remains a separate live check.
scripts/background-permissions.test.mjs covers unrelated protected processes and
keeps owned-process signal denial and unreadable process-directory failures blocking.
