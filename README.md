# open-dynamic-workflows (Cursor + Grok Build + Claude Code + Codex + ZCode plugin)

[中文文档](./README_CN.md)

Dynamic workflow orchestration for **Cursor, Grok Build, Claude Code, Codex, and ZCode** — fan a deterministic
JavaScript script out across many CLI subagents through a native `workflow` tool and authoring skill.

A dynamic workflow is a **plain-JS script that orchestrates subagents at scale**. The model
writes the script for the task; the plugin's bundled runtime executes it, fanning each
`agent()` call out to a real `cursor-agent`, `grok`, `claude`, `codex`, or `zcode` subprocess.

## Install (Cursor CLI)

Cursor CLI (`agent`, from [cursor.com/install](https://cursor.com/install)) does not yet install plugins from a marketplace the way Grok/Codex do. Use the repo installer — one copy-paste, then a **new** `agent` session has the `workflow` tool and the authoring skill. Omitted `executor` is `cursor`.

```bash
git clone --depth 1 https://github.com/atebites-hub/open-dynamic-workflows-plugin.git
node open-dynamic-workflows-plugin/scripts/install-cursor-cli.mjs
```

That writes an **absolute** MCP command into `~/.cursor/mcp.json` (CLI user/project `mcp.json` does not expand `${PLUGIN_ROOT}`), links the plugin into `~/.cursor/plugins/local/open-dynamic-workflows`, and copies the skill to `~/.cursor/skills/open-dynamic-workflows`. Then:

```bash
agent mcp enable open-dynamic-workflows
agent mcp list
```

Headless check: `agent -p --force --trust --workspace . --output-format json --approve-mcps`. Developers iterating on a checkout can skip the home install and load the dual-format plugin (Cursor Plugin + Agent Plugin) with `agent --plugin-dir /path/to/open-dynamic-workflows-plugin`.

### Cursor IDE

`cursor-agent plugin marketplace add atebites-hub/open-dynamic-workflows-plugin` only registers the marketplace. Install **open-dynamic-workflows** from Customize, or copy/symlink the plugin into `~/.cursor/plugins/local`. Plugin `mcp.json` still uses `${PLUGIN_ROOT}` for that loader.

Omitted `executor` runs on `cursor` (`agent` / `cursor-agent` / `CURSOR_BIN`). Nested Cursor leaves set `ODW_CURSOR_LEAF=1` and must not reload this plugin's `workflow` tool.

## Cursor team marketplace

This repository is the team marketplace catalog (`.cursor-plugin/marketplace.json`, name `atebites-cursor-plugins`). In **Dashboard → Plugins → Import from Repo**, import:

```text
https://github.com/atebites-hub/open-dynamic-workflows-plugin
```

Then in **Customize**, install:

- **open-dynamic-workflows** — this repo (`plugins/open-dynamic-workflows`)
- **ponytail** — https://github.com/DietrichGebert/ponytail
- **sol-advisor** — https://github.com/atebites-hub/sol-advisor

Remote `source` values are GitHub URLs, which the [official marketplace schema](https://raw.githubusercontent.com/cursor/plugins/main/schemas/marketplace.schema.json) allows. Plugin entries only use `name`, `source`, and `description`. If Import from Repo only indexes in-repo paths, add the ponytail and sol-advisor GitHub repos as additional marketplaces — this catalog does not vendor those trees.

CLI install for **open-dynamic-workflows** is still `node scripts/install-cursor-cli.mjs` above.

## Install (Grok Build)

```bash
grok plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
grok plugin install open-dynamic-workflows --trust
```

Open a new Grok session (or press `r` in the Plugins tab). Omitted `executor` runs on `grok`.
The plugin is self-contained; no project-local ODW checkout or build is needed.

## Install (Codex)

```bash
codex plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
codex plugin add open-dynamic-workflows@open-dynamic-workflows
```

Open a new Codex session. The plugin is self-contained; no project-local ODW checkout or build is
needed. Codex calls must pass the active workspace as `cwd` when invoking `workflow`.

## Install (Claude Code)

Install the repository as a Claude Code plugin (or validate the checked-in
`.claude-plugin/plugin.json` mirror), then enable the `open-dynamic-workflows` MCP server.
Omitted `executor` runs on `claude`; the server uses the Claude project directory when `cwd` is
omitted.

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
          └─ ODW runtime: runWorkflow({ executors: { cursor, zcode, grok, claude, codex } })
              ├─ agent({executor:'cursor'}) (or omitted on Cursor) spawns `cursor-agent -p …`
              ├─ agent({executor:'zcode'}) (or omitted on ZCode) spawns `zcode --prompt …`
              ├─ agent({executor:'grok'}) (or omitted on Grok Build) spawns `grok -p …`
              ├─ agent({executor:'claude'}) spawns `claude --print …`
              ├─ agent({executor:'codex'}) spawns `codex exec --json …`
              ├─ parallel()/pipeline() orchestrate, journal persists results
              └─ returns the script's `return` value + run metadata
```

Each executor uses the user's installed CLI from `PATH` (`GROK_BIN` / `ZCODE_BIN` / `CURSOR_BIN` override the
binary). Cursor runs headless `agent`/`cursor-agent -p` with `--output-format json` or `stream-json`,
`--force`, and `--workspace`. Nested cursor leaves do not reload this plugin's MCP (`ODW_CURSOR_LEAF=1`).
Grok runs headless `grok -p` with `--output-format json` or `streaming-json`,
`--always-approve`, and `--sandbox workspace` — never the broken `--tools` allowlist. Nested
grok leaves do not reload this plugin's MCP. Codex verifies `cwd` against the active workspace
metadata supplied by the host, then runs with JSONL output and a `workspace-write` sandbox.
ZCode uses `ZCODE_ODW_PROTOCOL=1`. Each agent is one real model turn. A Codex model override
defaults to `medium` reasoning unless the node supplies `reasoningEffort`. Completed agents
replay from the journal with zero token spend.

## A minimal workflow

```js
export const meta = { name: 'demo', description: 'two parallel grok agents' }

const results = await parallel([
  () => agent('What is 2+2? Reply with just the number.', { executor: 'grok', label: 'math' }),
  () => agent('Name a red planet. One word.', { executor: 'grok', label: 'trivia' }),
])
return { results }
```

Call `workflow({ cwd: "/absolute/project/path", script: "<the above>" })`; the tool returns
`{ value: { results: [...] }, runId, ok, ... }`.

See the `$open-dynamic-workflows` skill for the full authoring contract (phases, schemas,
the pipeline-vs-parallel decision, adversarial-verify / judge-panel / loop-until-dry shapes).

## Repository layout

This repo is the Cursor, Grok, Codex, and ZCode marketplace and the plugin.

```
├── .cursor-plugin/marketplace.json # Cursor team marketplace catalog (official schema)
├── .cursor-plugin/plugin.json      # Cursor plugin manifest
├── plugin.json                     # Agent Plugins manifest (CLI --plugin-dir)
├── mcp.json                        # Cursor MCP launch (${PLUGIN_ROOT}; IDE / plugin loader)
├── scripts/install-cursor-cli.mjs  # Cursor CLI home install (absolute MCP path)
├── .grok-plugin/marketplace.json   # Grok marketplace catalog
├── .grok-plugin/plugin.json        # Grok plugin manifest (repo-as-plugin / grok plugin install .)
├── .grok-plugin/mcp.json           # Grok MCP launch (GROK_PLUGIN_ROOT, 8h tool timeout)
├── plugins/open-dynamic-workflows/ # Grok marketplace package (catalog source; Grok rejects "./")
├── .agents/plugins/marketplace.json # Codex marketplace manifest
├── .codex-plugin/plugin.json       # Codex plugin manifest
├── .codex-mcp.json                 # Codex MCP launch config
├── marketplace.json                # ZCode marketplace manifest
├── .zcode-plugin/plugin.json       # ZCode plugin manifest
├── .mcp.json                       # ZCode stdio MCP server (${ZCODE_PLUGIN_ROOT})
├── .claude-plugin/plugin.json      # Claude Code manifest + MCP mirror
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
node scripts/install-cursor-cli.mjs   # Cursor CLI: MCP + local plugin + skill
```

The build (`scripts/build.mjs`) uses esbuild to inline ODW + its only dep (`ajv`) into a
single ESM file, matching the android-emulator plugin's pattern. No `node_modules` ship to
users.

## Governed routing (v0.3)

For a run that must use one exact route, pass an immutable policy:

```js
workflow({
  cwd: "/absolute/project/path",
  routingPolicy: {
    executor: "codex",
    model: "gpt-5.4",
    reasoningEffort: "high",
  },
  script,
})
```

The policy is validated by ODW core before the journal or any subprocess is opened. Every
omitted node route inherits it; an explicit executor, model, or reasoning-effort conflict fails
before launch. Nested workflows inherit the same policy. Policy runs cannot combine with
`resumeFromRunId` or cache replay. The MCP result exposes only the allowlisted policy tuple and
its SHA-256 `routingPolicyFingerprint`; this is correlation evidence, not proof that a host CLI
accepted the requested model. Inspect the run trace for the authoritative executor/model/effort
and runtime ID when the host provides them.

Without `routingPolicy`, existing host defaults remain unchanged: omitted executor selects
Cursor, Grok, Claude, Codex, or ZCode from the host launch environment. An explicit executor
still overrides that host default.

## Notes / scope (v0.3)

- **Host-native default worker.** Omitted `executor` uses cursor on Cursor, grok on Grok Build,
  zcode on ZCode, codex on Codex, claude on Claude Code. Name another worker to override.
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
