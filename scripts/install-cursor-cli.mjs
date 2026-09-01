#!/usr/bin/env node
// scripts/install-cursor-cli.mjs — install this plugin for Cursor CLI (`agent`)
// without the IDE Customize UI.
//
// Cursor's plugin loader expands ${PLUGIN_ROOT} in plugin mcp.json. User MCP
// config (~/.cursor/mcp.json) does not, so this installer writes an absolute
// `node /path/to/dist/mcp/server.js` command plus ODW_HOST=cursor.
// Skills are copied to ~/.cursor/skills/ because the CLI historically does not
// load plugin-bundled skills the way the IDE does.

import { cp, lstat, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const PLUGIN_NAME = "open-dynamic-workflows";
export const MCP_SERVER_NAME = "open-dynamic-workflows";

const PAYLOAD_FILES = [
  "dist/mcp/server.js",
  "skills/open-dynamic-workflows/SKILL.md",
  "commands/workflows.md",
  "mcp.json",
  "plugin.json",
  ".cursor-plugin/plugin.json",
];

export function pluginDir(home) {
  return join(home, ".cursor", "plugins", "local", PLUGIN_NAME);
}

export function skillDir(home) {
  return join(home, ".cursor", "skills", PLUGIN_NAME);
}

export function mcpConfigPath(home) {
  return join(home, ".cursor", "mcp.json");
}

function defaultSourceRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..");
}

function requiredSourceFile(sourceRoot, relative) {
  const path = join(sourceRoot, relative);
  if (!existsSync(path)) {
    throw new Error(
      `Cursor CLI install source is missing ${relative} (looked in ${sourceRoot}). ` +
        "Use a full plugin checkout that includes the committed dist/mcp/server.js bundle.",
    );
  }
  return path;
}

async function pathKind(path) {
  try {
    return await lstat(path);
  } catch (err) {
    if (err && typeof err === "object" && "code" in err && err.code === "ENOENT") {
      return null;
    }
    throw err;
  }
}

async function replaceWithCopy(sourceRoot, dest) {
  const destStat = await pathKind(dest);
  if (destStat) {
    await rm(dest, { recursive: true, force: true });
  }
  for (const relative of PAYLOAD_FILES) {
    const from = requiredSourceFile(sourceRoot, relative);
    const to = join(dest, relative);
    await mkdir(dirname(to), { recursive: true });
    await cp(from, to);
  }
}

async function replaceWithLink(sourceRoot, dest) {
  for (const relative of PAYLOAD_FILES) requiredSourceFile(sourceRoot, relative);
  await mkdir(dirname(dest), { recursive: true });
  const destStat = await pathKind(dest);
  if (destStat) {
    await rm(dest, { recursive: true, force: true });
  }
  await symlink(sourceRoot, dest);
}

async function installSkill(sourceRoot, destSkill) {
  const from = requiredSourceFile(sourceRoot, "skills/open-dynamic-workflows/SKILL.md");
  const destStat = await pathKind(destSkill);
  if (destStat) {
    await rm(destSkill, { recursive: true, force: true });
  }
  await mkdir(destSkill, { recursive: true });
  await cp(from, join(destSkill, "SKILL.md"));
}

async function readUserMcp(mcpPath) {
  const stat = await pathKind(mcpPath);
  if (!stat) {
    return { mcpServers: {} };
  }
  if (stat.isDirectory()) {
    throw new Error(`${mcpPath} is a directory; expected a JSON file.`);
  }
  const raw = await readFile(mcpPath, "utf8");
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`${mcpPath} is not valid JSON (${message}). Fix or remove it, then re-run.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${mcpPath} must be a JSON object with an mcpServers map.`);
  }
  if (parsed.mcpServers === undefined) {
    return { ...parsed, mcpServers: {} };
  }
  if (
    typeof parsed.mcpServers !== "object" ||
    parsed.mcpServers === null ||
    Array.isArray(parsed.mcpServers)
  ) {
    throw new Error(`${mcpPath} mcpServers must be an object.`);
  }
  return parsed;
}

async function writeUserMcp(mcpPath, config) {
  await mkdir(dirname(mcpPath), { recursive: true });
  const tmp = `${mcpPath}.tmp`;
  await writeFile(tmp, `${JSON.stringify(config, null, 2)}\n`);
  await cp(tmp, mcpPath);
  await rm(tmp, { force: true });
}

function nextStepsText({ plugin, skill, mcp }) {
  return [
    "Installed open-dynamic-workflows for Cursor CLI.",
    "",
    `  plugin: ${plugin}`,
    `  skill:  ${skill}`,
    `  mcp:    ${mcp}`,
    "",
    "Enable the MCP server once:",
    "",
    `  agent mcp enable ${MCP_SERVER_NAME}`,
    "",
    "Then start a new `agent` session. The `workflow` tool and",
    "`$open-dynamic-workflows` skill load without the IDE. Omitted",
    "executor is cursor (`agent` / `cursor-agent`).",
    "",
    "  agent mcp list",
    `  agent mcp list-tools ${MCP_SERVER_NAME}`,
    "",
    "Optional (slash command + plugin-dir loaders):",
    "",
    `  agent --plugin-dir ${plugin}`,
    "",
  ].join("\n");
}

export async function installCursorCli(options = {}) {
  const home = resolve(options.home ?? homedir());
  const sourceRoot = resolve(options.sourceRoot ?? defaultSourceRoot());
  const link = options.link === true;
  requiredSourceFile(sourceRoot, "dist/mcp/server.js");

  const destPlugin = pluginDir(home);
  const destSkill = skillDir(home);
  const mcpPath = mcpConfigPath(home);
  const sameDir = resolve(sourceRoot) === resolve(destPlugin);

  if (link) {
    await replaceWithLink(sourceRoot, destPlugin);
  } else if (!sameDir) {
    await replaceWithCopy(sourceRoot, destPlugin);
  } else {
    for (const relative of PAYLOAD_FILES) requiredSourceFile(sourceRoot, relative);
    await mkdir(destPlugin, { recursive: true });
  }

  const livePlugin = destPlugin;
  const serverPath = join(livePlugin, "dist", "mcp", "server.js");
  await installSkill(sourceRoot, destSkill);

  const mcp = await readUserMcp(mcpPath);
  mcp.mcpServers[MCP_SERVER_NAME] = {
    command: "node",
    args: [serverPath],
    env: {
      ODW_HOST: "cursor",
      CURSOR_PLUGIN_ROOT: livePlugin,
    },
  };
  await writeUserMcp(mcpPath, mcp);

  return {
    pluginDir: destPlugin,
    skillDir: destSkill,
    mcpPath,
    serverPath,
    nextSteps: nextStepsText({ plugin: destPlugin, skill: destSkill, mcp: mcpPath }),
  };
}

function parseArgs(argv) {
  const out = {
    home: homedir(),
    sourceRoot: defaultSourceRoot(),
    link: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      out.help = true;
      continue;
    }
    if (arg === "--link") {
      out.link = true;
      continue;
    }
    if (arg === "--home" || arg === "--source") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${arg} requires a path`);
      }
      i += 1;
      if (arg === "--home") out.home = value;
      else out.sourceRoot = value;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return out;
}

function helpText() {
  return [
    "Install Open Dynamic Workflows for Cursor CLI (`agent`).",
    "",
    "Usage:",
    "  node scripts/install-cursor-cli.mjs [--home DIR] [--source DIR] [--link]",
    "",
    "Writes:",
    "  ~/.cursor/plugins/local/open-dynamic-workflows",
    "  ~/.cursor/skills/open-dynamic-workflows",
    "  ~/.cursor/mcp.json  (absolute MCP command, ODW_HOST=cursor)",
    "",
  ].join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(helpText());
    return;
  }
  const result = await installCursorCli(args);
  process.stdout.write(`${result.nextSteps}\n`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (invokedDirectly) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[odw] Cursor CLI install failed: ${message}\n`);
    process.exit(1);
  });
}
