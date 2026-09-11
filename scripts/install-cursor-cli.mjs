#!/usr/bin/env node
// scripts/install-cursor-cli.mjs — Cursor CLI install without the Customize UI.
//
// Cursor CLI marketplace install is incomplete. This writes a working MCP entry
// with an absolute server path (CLI ~/.cursor/mcp.json does not expand
// ${PLUGIN_ROOT}), links the plugin into ~/.cursor/plugins/local, and copies
// the authoring skill into ~/.cursor/skills so a new `agent` session can see
// both the workflow tool and the skill.
//
// Plugin mcp.json keeps ${PLUGIN_ROOT} for the IDE / --plugin-dir loader.

import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_NAME = "open-dynamic-workflows";
const SERVER_REL = "dist/mcp/server.js";

function fail(message) {
  console.error(`open-dynamic-workflows: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let home = homedir();
  let pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  let host = "cursor";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--home") {
      home = argv[++i];
      if (!home) fail("--home requires a directory");
    } else if (arg === "--plugin-root") {
      pluginRoot = argv[++i];
      if (!pluginRoot) fail("--plugin-root requires a directory");
    } else if (arg === "--host") {
      host = argv[++i];
      if (host !== "cursor" && host !== "grok-bot") fail("--host must be cursor or grok-bot");
    } else if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      fail(`unknown argument: ${arg}`);
    }
  }
  return { home: resolve(home), pluginRoot: resolve(pluginRoot), host };
}

function printHelp() {
  console.log(`Usage: node scripts/install-cursor-cli.mjs [--home DIR] [--plugin-root DIR] [--host cursor|grok-bot]

Install Open Dynamic Workflows for Cursor CLI (\`agent\`) without Customize:
  ~/.cursor/mcp.json                         absolute MCP command (ODW_HOST=cursor)
  ~/.cursor/plugins/local/${PLUGIN_NAME}     plugin (symlink, copy fallback)
  ~/.cursor/skills/${PLUGIN_NAME}            authoring skill

Then:  agent mcp enable ${PLUGIN_NAME}
Dev:   agent --plugin-dir <plugin-root> --approve-mcps

For a Grok Bot VM, use --host grok-bot. This configures its Cursor CLI MCP entry;
it does not install/authenticate Cursor CLI or prove native Bot plugin loading.
Grok Bot must pass an absolute workflow cwd in that VM. Verify its CLI model and
usage allowance separately; do not substitute Grok Build or a Mac-side worker.
`);
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (err) {
    if (err && err.code === "ENOENT") return false;
    throw err;
  }
}

function sameResolved(a, b) {
  try {
    if (pathExists(a) && pathExists(b)) return realpathSync(a) === realpathSync(b);
  } catch {
    // fall through
  }
  return resolve(a) === resolve(b);
}

function requirePlugin(pluginRoot) {
  const server = join(pluginRoot, ...SERVER_REL.split("/"));
  if (!existsSync(server)) {
    fail(`missing ${SERVER_REL} under ${pluginRoot}`);
  }
  const cursorManifest = join(pluginRoot, ".cursor-plugin", "plugin.json");
  const agentManifest = join(pluginRoot, "plugin.json");
  if (!existsSync(cursorManifest) && !existsSync(agentManifest)) {
    fail(`missing plugin.json or .cursor-plugin/plugin.json under ${pluginRoot}`);
  }
  const skill = join(pluginRoot, "skills", PLUGIN_NAME, "SKILL.md");
  if (!existsSync(skill)) {
    fail(`missing skills/${PLUGIN_NAME}/SKILL.md under ${pluginRoot}`);
  }
  return realpathSync(server);
}

function installLocalPlugin(pluginRoot, dest) {
  mkdirSync(dirname(dest), { recursive: true });
  if (pathExists(dest) && sameResolved(dest, pluginRoot)) {
    return "already-at-plugin-root";
  }
  if (pathExists(dest)) {
    rmSync(dest, { recursive: true, force: true });
  }
  try {
    symlinkSync(pluginRoot, dest, process.platform === "win32" ? "junction" : "dir");
    return "symlink";
  } catch {
    mkdirSync(dest, { recursive: true });
    for (const relative of [
      ".cursor-plugin",
      "plugin.json",
      "mcp.json",
      "dist",
      "skills",
      "commands",
    ]) {
      const from = join(pluginRoot, relative);
      if (!existsSync(from)) continue;
      cpSync(from, join(dest, relative), { recursive: true });
    }
    return "copy";
  }
}

function mergeMcpConfig(mcpPath, serverPath, host) {
  mkdirSync(dirname(mcpPath), { recursive: true });
  let doc = { mcpServers: {} };
  if (pathExists(mcpPath)) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(mcpPath, "utf8"));
    } catch (err) {
      fail(`cannot parse ${mcpPath}: ${err instanceof Error ? err.message : err}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail(`${mcpPath} root must be a JSON object`);
    }
    doc = parsed;
    if (doc.mcpServers === undefined) doc.mcpServers = {};
    if (!doc.mcpServers || typeof doc.mcpServers !== "object" || Array.isArray(doc.mcpServers)) {
      fail(`${mcpPath} mcpServers must be an object`);
    }
  }
  doc.mcpServers[PLUGIN_NAME] = {
    command: "node",
    args: [serverPath],
    env: {
      ODW_HOST: host,
    },
  };
  const text = `${JSON.stringify(doc, null, 2)}\n`;
  const tmp = `${mcpPath}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  try {
    renameSync(tmp, mcpPath);
  } catch {
    writeFileSync(mcpPath, text);
    rmSync(tmp, { force: true });
  }
}

function installSkill(pluginRoot, dest) {
  const from = join(pluginRoot, "skills", PLUGIN_NAME);
  mkdirSync(dirname(dest), { recursive: true });
  if (pathExists(dest)) rmSync(dest, { recursive: true, force: true });
  cpSync(from, dest, { recursive: true });
}

function main() {
  const { home, pluginRoot, host } = parseArgs(process.argv.slice(2));
  const serverPath = requirePlugin(pluginRoot);
  const localPlugin = join(home, ".cursor", "plugins", "local", PLUGIN_NAME);
  const skillDest = join(home, ".cursor", "skills", PLUGIN_NAME);
  const mcpPath = join(home, ".cursor", "mcp.json");
  const localMode = installLocalPlugin(pluginRoot, localPlugin);
  installSkill(pluginRoot, skillDest);
  mergeMcpConfig(mcpPath, serverPath, host);

  console.log(`Installed ${PLUGIN_NAME} for Cursor CLI (host=${host}).

  MCP:    ${mcpPath}
          node ${serverPath}  (ODW_HOST=${host})
  Plugin: ${localPlugin}  (${localMode})
  Skill:  ${join(skillDest, "SKILL.md")}

A new \`agent\` session should see the \`workflow\` tool and the
\`open-dynamic-workflows\` authoring skill. Omitted executor is cursor.
Host configuration is not runtime attestation. Grok Bot must supply an absolute
VM project cwd and separately verify CLI authentication, model and usage pool.

If the server is listed but not enabled:

  agent mcp enable ${PLUGIN_NAME}
  agent mcp list
  agent mcp list-tools ${PLUGIN_NAME}

Headless smoke (after login):

  agent -p --force --trust --workspace . --output-format json --approve-mcps "List MCP tools named workflow."

Dev / no home mutation:

  agent --plugin-dir ${pluginRoot} --approve-mcps
`);
}

main();
