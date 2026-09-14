# Background job lifecycle

src/mcp/background.ts owns the Grok Bot start/status/cancel protocol and its
separate supervisor. All terminal paths terminate the owned runtime process group.
On Linux, a fresh runtime-only ODW_JOB_PROCESS_TOKEN also identifies detached
Cursor Shell sessions after reparenting. Cleanup matches UID and the exact marker,
then rechecks process starttime before signalling individual PIDs. No environment
contents or marker values are persisted. This is lifecycle cleanup, not a sandbox.

Status includes cleanup.method and cleanup.complete. The terminal receipt follows
cleanup. An unreadable same-user process or remaining marked process fails cleanup
closed as interrupted/ok=false. Other POSIX hosts retain process-group-only cleanup
and are not thereby qualified for detached Shell sessions. Fixtures live in
scripts/background.test.mjs; native acceptance remains a separate live check.
