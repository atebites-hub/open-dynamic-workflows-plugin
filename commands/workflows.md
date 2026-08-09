---
description: List and manage Open Dynamic Workflows runs in this project (active, completed, resumable)
---

# /open-dynamic-workflows:workflows

Inspect the workflow runs in this project. Each workflow keeps its runs under `.odw/<name>/runs/<runId>/` — a self-contained folder holding the script snapshot (`script.js`), the journal (`journal.jsonl`), the event log (`events.jsonl`), and per-agent traces (`agents/agent-N.jsonl`).

## What to do

1. Discover workflows: look for `.odw/*/script.js` relative to the current project directory. Each `<name>` dir is one workflow.
2. For each workflow, list its runs under `.odw/<name>/runs/`. Read each run's `events.jsonl` (last line) to determine status:
   - a `run_end` event with `"ok": true` → completed successfully
   - a `run_end` event with `"ok": false` → completed with failures
   - no `run_end` event → interrupted/aborted (resumable)
3. Present a compact summary to the user: workflow name, runId (short), status, agent count, tokens, duration. Answer in the user's language.
4. If the user asks to **resume** a run, they can re-run it with the run's `resumeFromRunId` by invoking the `workflow` tool with `{ scriptPath: ".odw/<name>/script.js", resumeFromRunId: "<runId>" }`. Completed agents replay from the journal with zero token spend.

## Notes

- Do not modify anything under `.odw/*/runs/` — it is the durable record.
- `.odw/*/runs/` is gitignored by convention; `.odw/*/script.js` is tracked.
- If there are no `.odw/` workflows in this project, say so and suggest the `$open-dynamic-workflows` skill to author one.

Optional arguments: $ARGUMENTS
