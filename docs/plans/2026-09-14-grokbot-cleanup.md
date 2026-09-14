# Grok Bot cancellation cleanup implementation plan

Goal: stop the job-owned Linux shell sessions that escape the CLI process group.
Scope: inline; approved by Jay on 2026-09-14. No model, auth or security override.

1. Reproduce separate PGID/SID ownership with a native Cursor shell and capture
   a harmless inherited marker. Compare SIGINT before adding cleanup machinery.
2. In src/mcp/background.ts, give only the runtime a fresh job marker. Reuse the
   supervisor's shared finish path for success, failure, cancellation and timeout.
   Kill its owned group, then boundedly sweep matching Linux processes. Recheck
   UID, marker and process starttime immediately before signalling. Never use cwd,
   a command-name match, a recovered PID, or a client-provided token as authority.
3. Extend scripts/background.test.mjs with detached-child fixtures and an unrelated
   same-cwd control. Keep non-Linux process-group behavior unchanged, not qualified
   for escaped Linux shells. Publish terminal receipts only after cleanup; cleanup
   errors must produce interrupted/ok=false, not a successful completion.
4. Update release metadata and authoring docs, regenerate host packages, run the
   complete gate and Linux packaged lifecycle tests. No core change is required:
   the supervisor owns the Grok Bot runtime and every terminal path uses it.
5. Publish the reviewed PR, install the exact bundle in the native Bot, and rerun
   cancellation plus two long real workers. Close issue #24 only on live evidence.

Limits: inherited markers are lifecycle ownership, not a security sandbox. A
malicious process can scrub its environment; marker scans are not kernel cgroups
or atomic pidfd signalling. No broader isolation or all-harness PASS is claimed.

## Approved CI regression repair

Jay requested fixing the startup regression and merging #26. Reproduce a protected
same-user /proc entry with the real helper, then ignore only per-process access
denials before ownership is established. Keep /proc enumeration and confirmed
owned-process signal failures blocking. Add bounded, unconditional subprocess
teardown to the host test so assertion failures cannot hide CI diagnostics.
Run the complete gate and require current-head CI success before merging.
