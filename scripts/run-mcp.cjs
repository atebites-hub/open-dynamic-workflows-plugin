#!/usr/bin/env node
// Launch the bundled MCP server from any host (Grok Build / Claude / ZCode / Codex).
// Resolves the plugin root from the host-provided env, then from this file's location.
"use strict";

const { spawn } = require("node:child_process");
const { join } = require("node:path");

const root =
  process.env.GROK_PLUGIN_ROOT ||
  process.env.CLAUDE_PLUGIN_ROOT ||
  process.env.ZCODE_PLUGIN_ROOT ||
  join(__dirname, "..");
const server = join(root, "dist", "mcp", "server.js");
const child = spawn(process.execPath, [server], { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
