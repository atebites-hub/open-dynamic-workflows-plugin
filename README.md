# open-dynamic-workflows (ZCode plugin)

[中文文档](./README_CN.md)

Dynamic workflow orchestration for **ZCode** — fan a deterministic JavaScript script out
across many `zcode` subagents. A faithful, model-agnostic reimplementation of Claude Code's
Workflow runtime, packaged as a ZCode plugin so it feels native: a `workflow` tool, an
authoring skill, and a `/workflows` command.

A dynamic workflow is a **plain-JS script that orchestrates subagents at scale**. The model
writes the script for the task; the plugin's bundled runtime executes it, fanning each
`agent()` call out to a real `zcode` subprocess. The control flow (loops, branching, fan-out)
lives in deterministic JS — the LLM work happens only at the leaves.

## Install (ZCode users)

```
/plugins marketplace add atebites-hub/open-dynamic-workflows-plugin
/plugins install open-dynamic-workflows
```

Then restart ZCode (or open a new session). That's it — no build step, no `node_modules`.
The plugin ships a self-contained `dist/mcp/server.js`.

After install, a session gets:
- a **`workflow` tool** — the model authors a script and calls `workflow({ script: "..." })`;
  it runs to completion and returns the script's value.
- the **`$open-dynamic-workflows` skill** — the authoring guide (when to reach for a workflow,
  the `meta`/`agent()`/`pipeline()`/`parallel()` contract, proven shapes).
- the **`/open-dynamic-workflows:workflows`** slash command — list and resume runs in the
  current project.

## How it works

```
model writes a JS workflow script
  └─ calls workflow({ script })
      └─ plugin's MCP server (dist/mcp/server.js)
          └─ ODW runtime: runWorkflow({ executors: { zcode: zcodeExecutor } })
              ├─ each agent({executor:'zcode'}) spawns `zcode --prompt …` (ZCODE_ODW_PROTOCOL=1)
              ├─ parallel()/pipeline() orchestrate, journal persists results
              └─ returns the script's `return` value + run metadata
```

The `zcode` executor spawns the user's **installed `zcode`** by name (whatever's on `PATH`)
with `ZCODE_ODW_PROTOCOL=1`, so the launcher emits a machine-readable `zcode_result` envelope.
Each agent is one real model turn. Runs are resumable: completed agents replay from the journal
with zero token spend.

## A minimal workflow

```js
export const meta = { name: 'demo', description: 'two parallel zcode agents' }

const results = await parallel([
  () => agent('What is 2+2? Reply with just the number.', { executor: 'zcode', label: 'math' }),
  () => agent('Name a red planet. One word.', { executor: 'zcode', label: 'trivia' }),
])
return { results }
```

Call `workflow({ script: "<the above>" })` and the tool returns `{ value: { results: [...] }, runId, ok, ... }`.

See the `$open-dynamic-workflows` skill for the full authoring contract (phases, schemas,
the pipeline-vs-parallel decision, adversarial-verify / judge-panel / loop-until-dry shapes).

## Repository layout

This repo is **both** the marketplace and the plugin (`marketplace.json` uses `"source": "./"`).

```
├── marketplace.json                # marketplace manifest (this repo = the plugin)
├── .zcode-plugin/plugin.json       # ZCode plugin manifest
├── .claude-plugin/plugin.json      # Claude Code compatibility mirror
├── .mcp.json                       # declares the stdio MCP server
├── skills/open-dynamic-workflows/  # authoring skill (vendored from ODW)
├── commands/workflows.md           # /workflows slash command
├── src/mcp/server.ts               # MCP server source (the `workflow` tool)
├── dist/mcp/server.js              # COMMITTED self-contained bundle (what runs)
├── scripts/{build,setup,smoke}.mjs # dev build + smoke pipeline
├── open-dynamic-workflows/         # git submodule (ODW source — dev only)
└── zcode-cli/                      # git submodule (dev convenience; not bundled)
```

### For maintainers / contributors

The `dist/mcp/server.js` that users run is built from the submodules and committed. After
cloning:

```bash
npm run setup    # init submodules + npm install + build ODW + esbuild → dist/mcp/server.js
npm run smoke    # standalone JSON-RPC smoke test of the built server
npm run build    # rebuild just the bundle (skips submodule init)
```

The build (`scripts/build.mjs`) uses esbuild to inline ODW + its only dep (`ajv`) into a
single ESM file, matching the android-emulator plugin's pattern. No `node_modules` ship to
users.

## Notes / scope (v0.1)

- **zcode-only workers.** The plugin registers `{ zcode: zcodeExecutor }`. Scripts that name
  another executor fail with ODW's clear "unknown executor" error. Claude/codex support is a
  future `userConfig` toggle away.
- **Synchronous tool.** `workflow()` runs to completion and returns (v1). Background execution
  with task notifications is a v2 enhancement.
- **No ultracode auto-decide.** The recommendation is passive — the skill and tool
  descriptions tell the model when a workflow fits. The model decides; nothing is force-injected.
- **Telemetry.** The `zcode_result` envelope currently reports `costUsd`/`inputTokens`/
  `outputTokens` as null (`telemetryAvailable: false`). The plugin reports zeros honestly
  until the zcode launcher fills these in.

License: MIT.
