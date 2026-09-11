import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const binary = process.env.ANTIGRAVITY_BIN || process.env.AGY_BIN || "agy";
const server = resolve(root, "dist/mcp/server.js");
const plugin = resolve(root, "plugins/antigravity/open-dynamic-workflows");
if (!existsSync(server) || !existsSync(resolve(plugin, "skills/open-dynamic-workflows/SKILL.md"))) {
  throw new Error("Build the plugin before installing: npm run build");
}
// Use the native config writer; no undocumented plugin-root interpolation.
execFileSync(binary, ["mcp", "add", "--env", "ODW_HOST=antigravity", "open-dynamic-workflows", process.execPath, server], { stdio: "inherit" });
execFileSync(binary, ["plugin", "install", plugin], { stdio: "inherit" });
console.log("Antigravity CLI MCP and skill installed. Start a fresh session. Headless worktree writes still require your scoped permission rules.");
