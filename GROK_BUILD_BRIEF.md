# Grok Build expansion brief

This plugin is a Claude-compatible Grok Build plugin (`.claude-plugin/plugin.json`,
`.grok-plugin/marketplace.json`, `skills/`, `commands/`, `.mcp.json`).

## Install on a Grok Build box (Palemon studio)

Until the marketplace PR is on `main`, prefer a trusted local path:

```bash
grok plugin install /workspace/open-dynamic-workflows-plugin --trust
grok plugin list
grok plugin details open-dynamic-workflows
```

Then add the GitHub marketplace source:

```bash
grok plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
```

## Executor `grok`

`agent({ executor: 'grok' })` spawns a headless Grok Build leaf:

- CLI: `GROK_BIN` or `grok` on `PATH`
- Studio PATH: `/home/box/.grok/bin` (also `$HOME/.grok/bin`); the executor prepends these
- Headless: `--prompt-file` (subprocess-safe `grok -p`) + `--output-format streaming-json`
  (`json` is pretty-printed, so the line-based driver cannot use it; `plain` has no usage)
- Subprocess flags: `--permission-mode acceptEdits --no-subagents --no-plan --no-memory
  --verbatim --no-auto-update`
- Optional host env: `GROK_ODW_PERMISSION_MODE=bypassPermissions`, `GROK_ODW_ALWAYS_APPROVE=1`

## Directors

Fan many grok leaves with `pipeline()` / `parallel()`. Cursor Cloud Extra High is a
sibling path (`scripts/launch-cloud-extra-high.sh` from the Palemon repo) — not an ODW
executor, and never put secrets in the workflow script.

Not in scope: Grok Bot CloudAgent, VM cursor-grok feature waves.
