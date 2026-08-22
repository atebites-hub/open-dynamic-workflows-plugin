// scripts/build.mjs — build the plugin's self-contained MCP server.
// scripts/build.mjs —— 构建插件的自包含 MCP server。
//
// Two stages (mirrors the android-emulator plugin's esbuild pattern, with an ODW build
// prepended because ODW ships source, not dist):
// 两个阶段（对应 android-emulator 插件的 esbuild 模式，前面加一步 ODW 构建，
// 因为 ODW 交付的是源码而非 dist）：
//   1. Build ODW (tsc → open-dynamic-workflows/dist/) if the submodule is present.
//   2. esbuild-bundle src/mcp/server.ts + ODW + ajv → dist/mcp/server.js (single ESM file).
//
// The result has zero runtime dependencies — no node_modules needed by the installed
// plugin (matches every other zcode plugin: android-emulator, example-plugin, ponytail).
// 结果运行时零依赖——安装后的插件不需要 node_modules（与所有其它 zcode 插件一致：
// android-emulator、example-plugin、ponytail）。
//
// Run: `node scripts/build.mjs` (after `npm ci --ignore-scripts` for esbuild).
// Also run via `npm run setup`, which chains submodule init + install + this build.

import { chmod, cp, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { build } from "esbuild";
import { execSync } from "node:child_process";

const root = resolve(import.meta.dirname, "..");
const odwSubmodule = resolve(root, "open-dynamic-workflows");
const odwDist = resolve(odwSubmodule, "dist");
const serverOutputPath = resolve(root, "dist", "mcp", "server.js");

// ── Stage 1: build ODW from source (tsc → dist/) ──────────────────────────────
// Only if the submodule is initialized. If you're iterating on the server glue only and
// ODW dist/ already exists, this still re-runs tsc (fast). Skip with ODW_SKIP_BUILD=1.
// 仅当 submodule 已初始化时执行。如果你只在迭代 server 胶水代码且 ODW dist/ 已存在，
// 这里仍会重跑 tsc（很快）。用 ODW_SKIP_BUILD=1 跳过。
if (!process.env.ODW_SKIP_BUILD) {
  if (!existsSync(resolve(odwSubmodule, "package.json"))) {
    console.error(
      "[build] ODW submodule not present. Run `node scripts/setup.mjs` first, or " +
        "`git submodule update --init open-dynamic-workflows`.",
    );
    process.exit(1);
  }
  console.log("[build] installing + building ODW (npm ci --ignore-scripts && npm run build)…");
  execSync("npm ci --ignore-scripts && npm run build", { cwd: odwSubmodule, stdio: "inherit" });
  if (!existsSync(resolve(odwDist, "index.js"))) {
    console.error("[build] ODW build did not produce dist/index.js.");
    process.exit(1);
  }
} else {
  console.log("[build] ODW_SKIP_BUILD=1 — skipping ODW build (using existing dist/).");
  if (!existsSync(resolve(odwDist, "index.js"))) {
    console.error("[build] ODW dist/index.js missing even though ODW_SKIP_BUILD=1. Run setup first.");
    process.exit(1);
  }
}

// ── Stage 2: esbuild-bundle the MCP server + ODW + ajv → one file ─────────────
console.log("[build] esbuild → dist/mcp/server.js…");
await rm(resolve(root, "dist", "mcp"), { recursive: true, force: true });
await mkdir(resolve(root, "dist", "mcp"), { recursive: true });

await build({
  bundle: true, // inline ALL imports (ODW + ajv) — no node_modules at runtime
  // 内联所有导入（ODW + ajv）——运行时无需 node_modules
  entryPoints: [resolve(root, "src", "mcp", "server.ts")],
  format: "esm",
  legalComments: "none",
  outfile: serverOutputPath,
  platform: "node",
  target: "node24", // matches android-emulator + zcode's Electron Node
});

await chmod(serverOutputPath, 0o755);
console.log(`[build] done → ${serverOutputPath}`);

// Grok marketplace entries cannot use source "./" (empty path). Sync the
// installable plugin package under plugins/open-dynamic-workflows/.
const grokPluginDir = resolve(root, "plugins", "open-dynamic-workflows");
console.log("[build] sync Grok marketplace plugin package…");
await rm(resolve(grokPluginDir, "dist"), { recursive: true, force: true });
await rm(resolve(grokPluginDir, "skills"), { recursive: true, force: true });
await rm(resolve(grokPluginDir, "commands"), { recursive: true, force: true });
await cp(resolve(root, "dist"), resolve(grokPluginDir, "dist"), { recursive: true });
await cp(resolve(root, "skills"), resolve(grokPluginDir, "skills"), { recursive: true });
await cp(resolve(root, "commands"), resolve(grokPluginDir, "commands"), { recursive: true });
for (const relative of [
  "mcp.json",
  ".cursor-plugin/plugin.json",
  ".grok-plugin/plugin.json",
  ".grok-plugin/mcp.json",
]) {
  const source = resolve(root, relative);
  const target = resolve(grokPluginDir, relative);
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target);
}
console.log(`[build] grok plugin package → ${grokPluginDir}`);
