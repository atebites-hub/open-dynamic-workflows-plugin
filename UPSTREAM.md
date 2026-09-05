# Packaging and nested-fork maintenance

This repository is **atebites packaging** of Open Dynamic Workflows for Cursor, Grok Build, Claude Code, Codex, and ZCode. It is **not** a GitHub fork of an upstream plugin (`fork: false` in marketplace catalogs). Do not convert it into a fork of `imsai-sh/open-dynamic-workflows` or `kingsword09/zcode-cli` — those parent relationships belong on the nested remotes below.

Users install this repo (or a marketplace pin of it). The shipped `dist/mcp/server.js` is a committed, self-contained bundle built from the nested ODW core. `zcode-cli` is a checkout convenience only: the plugin never imports it; `zcodeExecutor` spawns the user's installed `zcode`.

## Nested remotes

| Path | atebites remote | Upstream parent | Role |
| --- | --- | --- | --- |
| `open-dynamic-workflows/` | [atebites-hub/open-dynamic-workflows](https://github.com/atebites-hub/open-dynamic-workflows) | [imsai-sh/open-dynamic-workflows](https://github.com/imsai-sh/open-dynamic-workflows) | ODW core. True GitHub fork. Bundled into `dist/mcp/server.js`. |
| `zcode-cli/` | [atebites-hub/zcode-cli](https://github.com/atebites-hub/zcode-cli) | [kingsword09/zcode-cli](https://github.com/kingsword09/zcode-cli) | True GitHub fork. Dev convenience for the ODW↔launcher protocol. Not bundled. |

`.gitmodules` already points both URLs at the atebites-hub remotes. Keep those URLs. Each nested repo has its own `UPSTREAM.md` (or equivalent) for merging *its* parent.

Historical only — never pin this SHA again:

- Old zcode-cli gitlink `a97033febe288e2e15ff3e4fd5517aef5a42e369` exists on [atebites-hub/zcode-cli-legacy](https://github.com/atebites-hub/zcode-cli-legacy), not on the true fork. Recursive `git submodule update --init` fails until the gitlink is a commit that exists on `atebites-hub/zcode-cli`.

Current pins are the gitlinks (`git ls-tree HEAD open-dynamic-workflows zcode-cli`). This retarget pins `zcode-cli` to true-fork `main` at `040993c2990dbf00d0cc6ff8044d510e065adcbe` (`feat: port factory upgrades and add upstream sync`). Leave the ODW core SHA alone unless that fork’s CI + smoke are green and a rebuild of `dist/` is part of the same change.

## Owners

- **Jaskarn** (atebites-hub)
- **Factory Plugins bot**

## Why packaging exists

The nested forks own factory behavior (immutable `routingPolicy` in ODW core; `ZCODE_ODW_PROTOCOL=1`, Advisor routing, attestation in zcode-cli). This repo exists because a plugin is not a fork:

- Multi-host marketplace catalogs and manifests (Cursor, Grok, Claude, Codex, ZCode) with host-native omitted-`executor` defaults.
- A committed esbuild bundle so installers do not need `node_modules` or a local ODW checkout.
- Cursor CLI home install (`scripts/install-cursor-cli.mjs`) and the Grok package under `plugins/open-dynamic-workflows/`.
- MCP glue, skill, and `/workflows` command that wrap the nested runtime.

Do not drop that packaging to “just vendor upstream.” Do not bump [atebites-plugins](https://github.com/atebites-hub/atebites-plugins) in the same change as a nested pin.

## Native alignment (required)

The nested ODW core and this packaging repo stay on Claude, Codex, and Cursor. Native-first
prefers Claude ultracode, Codex/ChatGPT ultra, and Cursor multitask when they fit; that is
not a reason to skip ODW or to treat a Cursor multitask investigation as “ODW unused.”
Align: detect those modes, do not fight them, document seating/composition or an explicit
defer, and fill cross-executor / multi-harness gaps.

**Status:** required by policy. Proven only after live QA. Do not soft-pass. User-facing
wording lives in [README.md](./README.md#native-alignment-required).

## Pin bump policy

Bump a nested pin only after **that fork** is ready, then let the marketplace consume *this* plugin SHA:

1. Nested fork `main` moved, its CI is green, and its own smoke (or documented harness gap) is recorded.
2. Update the gitlink here to that fork’s merge commit on `main`. If `open-dynamic-workflows` moved, rebuild (`npm run setup` / `npm run verify`) and commit any `dist/` + `plugins/open-dynamic-workflows/` drift.
3. This plugin’s CI + smoke must pass.
4. **Separate follow-up:** marketplace catalogs that pin this repo (atebites-plugins, and any other consumer) take the new plugin SHA. Do not sneak those pin bumps into the nested-sync PR.

`zcode-cli` pin bumps do not change the bundle. `open-dynamic-workflows` pin bumps usually do.

Plugin CI audits this repo’s lock as a required check, and still runs `npm --prefix open-dynamic-workflows audit --package-lock-only --audit-level high` against the **pinned** ODW lock as an informational step. That lock (and current ODW `main` as of this writing) still has `fast-uri@3.1.5` (`GHSA-5jgf-p345-68v8` and related). The fix belongs on the ODW fork. Do not edit the submodule tree here to silence it, and do not treat that advisory as a reason to bump the ODW pin in the same PR as a zcode-cli retarget. When the ODW fork ships a clean lock, bump the pin and make the nested audit required again.

## Weekday sync

`.github/workflows/sync-nested-pins.yml` (UTC cron on weekdays, plus `workflow_dispatch`) compares each gitlink to that remote’s `main`. When a remote moved, it opens **one** PR titled exactly `chore: sync nested pins`. If a PR with that title is already open, the workflow leaves it alone.

`GITHUB_TOKEN` pull requests do not start other workflows. Set repository secret `UPSTREAM_SYNC_TOKEN` (Factory Plugins bot PAT with `contents` + `pull-requests`) so sync PRs still run CI.

Do not merge a sync PR until the pin policy above is satisfied. The workflow records whether each nested `main` is ahead; it does not replace fork CI + smoke.

### Manual / agent sync

```bash
# Table of pin vs remote main. Exit 1 if anything drifted.
bash scripts/sync-nested-pins.sh check

# Move drifted gitlinks to the remotes’ main (does not commit).
bash scripts/sync-nested-pins.sh apply

# If open-dynamic-workflows moved:
git submodule update --init open-dynamic-workflows
npm run setup
npm run verify

git checkout -b chore/sync-nested-pins
git add open-dynamic-workflows zcode-cli dist plugins/open-dynamic-workflows
git commit -m "chore: sync nested pins"
git push -u origin HEAD
# Open PR title: chore: sync nested pins
```

After merge, marketplace pin bumps stay a separate PR.

### After every nested pin bump

- [ ] Nested SHA exists on the atebites-hub remote (not on `zcode-cli-legacy`)
- [ ] That fork’s CI + smoke are green, or the gap is written in the PR
- [ ] Plugin `npm run verify` / CI green
- [ ] ODW core bumps include a rebuilt `dist/mcp/server.js` when the bundle changed
- [ ] atebites-plugins / other marketplace pins **not** changed here
