// scripts/setup.mjs — one-command dev setup for the plugin.
// scripts/setup.mjs —— 插件的一键开发环境搭建。
//
// Chains the steps a contributor needs after a fresh clone:
// 串联贡献者全新 clone 后所需的步骤：
//   1. Init + update git submodules (ODW + zcode-cli source).
//   2. Install the plugin's own dev deps (esbuild, typescript, @types/node).
//   3. Build ODW (npm install + tsc → open-dynamic-workflows/dist/).
//   4. esbuild-bundle the MCP server → dist/mcp/server.js.
//
// Note: zcode-cli is a submodule purely for co-editing convenience (working on the
// ODW↔launcher protocol bridge in one tree). It is NOT built or bundled — the plugin
// never imports zcode-cli code; zcodeExecutor only spawns the user's installed `zcode`.
// 注意：zcode-cli 作为 submodule 纯粹是为了便于共同编辑（在同一棵树里改 ODW↔launcher
// 协议桥）。它不会被构建或打包——插件从不 import zcode-cli 的代码；zcodeExecutor 只
// spawn 用户安装的 `zcode`。

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function run(cmd, opts = {}) {
  console.log(`\n[setup] $ ${cmd}`);
  execSync(cmd, { cwd: root, stdio: "inherit", ...opts });
}

// 1. Submodules.
// 1. Submodule。
if (!existsSync(resolve(root, "open-dynamic-workflows", "package.json"))) {
  console.log("[setup] initializing git submodules…");
  run("git submodule update --init --recursive");
} else {
  console.log("[setup] submodules already present.");
}

// 2. Plugin dev deps.
// 2. 插件开发依赖。
console.log("[setup] installing plugin dev deps (npm install)…");
run("npm install");

// 3 + 4. Build ODW then esbuild the server (delegated to build.mjs).
// 3 + 4. 先构建 ODW 再 esbuild server（委托给 build.mjs）。
console.log("[setup] building (ODW tsc + esbuild)…");
run("node scripts/build.mjs");

console.log("\n[setup] ✓ done. The plugin is built at dist/mcp/server.js.");
console.log("[setup]   - smoke test:   npm run smoke");
console.log("[setup]   - local install: see README.md → 'Local install test'");
