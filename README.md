# open-dynamic-workflows (Codex + ZCode plugin)

[中文文档](./README_CN.md)

Dynamic workflow orchestration for **Codex and ZCode** — fan a deterministic JavaScript script
out across many CLI subagents through a native `workflow` tool and authoring skill.

A dynamic workflow is a **plain-JS script that orchestrates subagents at scale**. The model
writes the script for the task; the plugin's bundled runtime executes it, fanning each
`agent()` call out to a real `codex` or `zcode` subprocess. The control flow (loops, branching, fan-out)
lives in deterministic JS — the LLM work happens only at the leaves.

## Install (Codex)

```bash
codex plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
codex plugin add open-dynamic-workflows@open-dynamic-workflows
```

Open a new Codex session. The plugin is self-contained; no project-local ODW checkout or build is
needed. Codex calls must pass the active workspace as `cwd` when invoking `workflow`.

## Install (ZCode users)

```
/plugins marketplace add atebites-hub/open-dynamic-workflows-plugin
/plugins install open-dynamic-workflows
```

Then restart ZCode (or open a new session). That's it — no build step, no `node_modules`.
The plugin ships a self-contained `dist/mcp/server.js`.

After install, a session gets:
- a **`workflow` tool** — the model authors a script and calls `workflow({ cwd, script })`;
  it runs to completion and returns the script's value.
- the **`$open-dynamic-workflows` skill** — the authoring guide (when to reach for a workflow,
  the `meta`/`agent()`/`pipeline()`/`parallel()` contract, proven shapes).
- the **`/open-dynamic-workflows:workflows`** slash command — list and resume runs in the
  current project.

## How it works

```
model writes a JS workflow script
  └─ calls workflow({ cwd, script })
      └─ plugin's MCP server (dist/mcp/server.js)
          └─ ODW runtime: runWorkflow({ executors: { codex, zcode } })
              ├─ agent({executor:'codex'}) spawns `codex exec --json …`
              ├─ agent({executor:'zcode'}) spawns `zcode --prompt …` (ZCODE_ODW_PROTOCOL=1)
              ├─ parallel()/pipeline() orchestrate, journal persists results
              └─ returns the script's `return` value + run metadata
```

Both executors use the user's installed CLI from `PATH`. Codex verifies `cwd` against the active
workspace metadata supplied by the host, then runs with JSONL output and a `workspace-write`
sandbox. Its native shell policy removes key/secret/token variables from model-run commands.
ZCode uses `ZCODE_ODW_PROTOCOL=1`. Each agent is one real model turn. A Codex model override
defaults to `medium` reasoning unless the node supplies `reasoningEffort`, avoiding incompatible
user-level settings. Completed agents replay from the journal with zero token spend.

## A minimal workflow

```js
export const meta = { name: 'demo', description: 'two parallel codex agents' }

const results = await parallel([
  () => agent('What is 2+2? Reply with just the number.', { executor: 'codex', label: 'math' }),
  () => agent('Name a red planet. One word.', { executor: 'codex', label: 'trivia' }),
])
return { results }
```

Call `workflow({ cwd: "/absolute/project/path", script: "<the above>" })`; the tool returns
`{ value: { results: [...] }, runId, ok, ... }`.

See the `$open-dynamic-workflows` skill for the full authoring contract (phases, schemas,
the pipeline-vs-parallel decision, adversarial-verify / judge-panel / loop-until-dry shapes).

## Repository layout

This repo is both the Codex and ZCode marketplace and the plugin.

```
├── .agents/plugins/marketplace.json # Codex marketplace manifest
├── .codex-plugin/plugin.json       # Codex plugin manifest
├── .codex-mcp.json                 # Codex MCP launch config
├── marketplace.json                # ZCode marketplace manifest
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
npm run setup    # init submodules + locked installs + build ODW + esbuild → dist/mcp/server.js
npm run smoke    # standalone JSON-RPC smoke test of the built server
npm run build    # rebuild just the bundle (skips submodule init)
npm run verify   # rebuild and run the plugin smoke checks
```

The build (`scripts/build.mjs`) uses esbuild to inline ODW + its only dep (`ajv`) into a
single ESM file, matching the android-emulator plugin's pattern. No `node_modules` ship to
users.

## Notes / scope (v0.2)

- **Codex and ZCode workers.** The plugin registers both executors; every `agent()` still names
  one explicitly. Unknown names fail fast.
- **Synchronous tool.** `workflow()` runs to completion and returns (v1). Background execution
  with task notifications is a v2 enhancement.
- **Local evidence.** `.odw/` artifacts contain workflow scripts, prompts, and agent responses;
  newly written run files are owner-only. Keep `.odw/` gitignored.
- **No ultracode auto-decide.** The recommendation is passive — the skill and tool
  descriptions tell the model when a workflow fits. The model decides; nothing is force-injected.
- **Telemetry.** The `zcode_result` envelope currently reports `costUsd`/`inputTokens`/
  `outputTokens` as null (`telemetryAvailable: false`). The plugin reports zeros honestly
  until the zcode launcher fills these in.

License: MIT.
