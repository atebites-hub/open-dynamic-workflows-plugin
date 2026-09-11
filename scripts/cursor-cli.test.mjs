// scripts/cursor-cli.test.mjs — Cursor CLI install path + marketplace schema.
// Official Cursor marketplace plugin entries are additionalProperties:false:
// name, source, description, minClientVersions only.
// CLI user mcp.json does not expand ${PLUGIN_ROOT}; the installer must write
// an absolute path. Plugin mcp.json keeps ${PLUGIN_ROOT} for the IDE loader.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const installer = join(root, "scripts", "install-cursor-cli.mjs");
const cursorMarketplacePath = join(root, ".cursor-plugin", "marketplace.json");
const agentPluginPath = join(root, "plugin.json");
const cursorMcpPath = join(root, "mcp.json");
const packagedMcpPath = join(root, "plugins", "open-dynamic-workflows", "mcp.json");
const packagedAgentPluginPath = join(root, "plugins", "open-dynamic-workflows", "plugin.json");

const MARKETPLACE_ROOT_KEYS = new Set(["name", "owner", "metadata", "plugins"]);
const MARKETPLACE_OWNER_KEYS = new Set(["name", "email"]);
const MARKETPLACE_PLUGIN_KEYS = new Set(["name", "source", "description", "minClientVersions"]);
const AGENT_PLUGIN_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
const AGENT_MCP_SCHEMA = "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json";

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function assertExactKeys(object, allowed, label) {
  assert.equal(object && typeof object === "object" && !Array.isArray(object), true, `${label} must be an object`);
  for (const key of Object.keys(object)) {
    assert.ok(allowed.has(key), `${label} has disallowed key ${key}`);
  }
}

test("Cursor marketplace.json is a schema-valid three-plugin team catalog", () => {
  const marketplace = readJson(cursorMarketplacePath);
  const pluginName = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/;
  assertExactKeys(marketplace, MARKETPLACE_ROOT_KEYS, ".cursor-plugin/marketplace.json");
  assert.equal(marketplace.name, "atebites-cursor-plugins");
  assert.ok(Array.isArray(marketplace.plugins));
  assert.equal(marketplace.plugins.length, 3);
  if (marketplace.owner !== undefined) {
    assertExactKeys(marketplace.owner, MARKETPLACE_OWNER_KEYS, "marketplace.owner");
    assert.equal(typeof marketplace.owner.name, "string");
  }
  for (const [index, plugin] of marketplace.plugins.entries()) {
    assertExactKeys(plugin, MARKETPLACE_PLUGIN_KEYS, `marketplace.plugins[${index}]`);
    assert.match(plugin.name, pluginName);
    assert.equal(typeof plugin.source, "string");
    assert.ok(plugin.source.length > 0);
    assert.equal(typeof plugin.description, "string");
    assert.equal(plugin.version, undefined);
    assert.equal(plugin.keywords, undefined);
  }
  const byName = Object.fromEntries(marketplace.plugins.map((plugin) => [plugin.name, plugin]));
  assert.equal(byName["open-dynamic-workflows"].source, "plugins/open-dynamic-workflows");
  assert.equal(byName.ponytail.source, "https://github.com/atebites-hub/ponytail");
  assert.equal(byName["sol-advisor"].source, "https://github.com/atebites-hub/sol-advisor");
  for (const plugin of marketplace.plugins) {
    if (/^https?:\/\//.test(plugin.source)) {
      assert.match(plugin.source, /^https:\/\/github\.com\/atebites-hub\//);
    }
  }
});

test("repo and marketplace package ship a dual-format Agent Plugin manifest", () => {
  for (const path of [agentPluginPath, packagedAgentPluginPath]) {
    const manifest = readJson(path);
    assert.equal(manifest.$schema, AGENT_PLUGIN_SCHEMA, path);
    assert.equal(manifest.name, "open-dynamic-workflows");
    assert.equal(typeof manifest.version, "string");
    assert.equal(typeof manifest.description, "string");
  }
});

test("plugin mcp.json stays PLUGIN_ROOT-relative and Agent-Plugin valid", () => {
  for (const path of [cursorMcpPath, packagedMcpPath]) {
    const mcp = readJson(path);
    assert.equal(mcp.$schema, AGENT_MCP_SCHEMA, path);
    const server = mcp.mcpServers["open-dynamic-workflows"];
    assert.equal(server.type, "stdio");
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, ["${PLUGIN_ROOT}/dist/mcp/server.js"]);
    assert.equal(server.env.ODW_HOST, "cursor");
    assert.ok(!Object.hasOwn(server, "cwd"), `${path} must not pin cwd`);
  }
});

function runInstaller(home, extraArgs = []) {
  assert.equal(existsSync(installer), true, "scripts/install-cursor-cli.mjs must exist");
  const result = spawnSync(process.execPath, [installer, "--home", home, ...extraArgs], {
    cwd: root,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result;
}

test("installer writes absolute MCP, local plugin, and authoring skill without PLUGIN_ROOT", () => {
  const home = mkdtempSync(join(tmpdir(), "odw-cursor-cli-"));
  try {
    writeFileSync(
      join(home, ".cursor-mcp-preexisting"),
      "keep",
    );
    mkdirSync(join(home, ".cursor"), { recursive: true });
    writeFileSync(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          other: { command: "echo", args: ["ok"] },
        },
      }),
    );
    const result = runInstaller(home);
    assert.equal(existsSync(join(home, ".cursor-mcp-preexisting")), true);
    const mcp = readJson(join(home, ".cursor", "mcp.json"));
    assert.deepEqual(mcp.mcpServers.other, { command: "echo", args: ["ok"] });
    const server = mcp.mcpServers["open-dynamic-workflows"];
    const expectedServer = resolve(root, "dist", "mcp", "server.js");
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, [expectedServer]);
    assert.equal(server.env.ODW_HOST, "cursor");
    assert.equal(JSON.stringify(server).includes("${PLUGIN_ROOT}"), false);
    assert.ok(!Object.hasOwn(server, "cwd"));

    const localPlugin = join(home, ".cursor", "plugins", "local", "open-dynamic-workflows");
    assert.equal(existsSync(join(localPlugin, ".cursor-plugin", "plugin.json")), true);
    assert.equal(existsSync(join(localPlugin, "plugin.json")), true);
    assert.equal(existsSync(join(localPlugin, "dist", "mcp", "server.js")), true);
    assert.equal(realpathSync(join(localPlugin, "dist", "mcp", "server.js")), realpathSync(expectedServer));

    const skill = join(home, ".cursor", "skills", "open-dynamic-workflows", "SKILL.md");
    assert.equal(existsSync(skill), true);
    assert.match(readFileSync(skill, "utf8"), /export const meta/);

    assert.match(result.stdout, /agent mcp enable open-dynamic-workflows/);
    assert.match(result.stdout, /--plugin-dir/);
    assert.match(result.stdout, /mcp list/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installer is idempotent and refreshes a stale MCP path", () => {
  const home = mkdtempSync(join(tmpdir(), "odw-cursor-cli-idempotent-"));
  try {
    runInstaller(home);
    const mcpPath = join(home, ".cursor", "mcp.json");
    const first = readJson(mcpPath);
    first.mcpServers["open-dynamic-workflows"].args = ["/stale/dist/mcp/server.js"];
    writeFileSync(mcpPath, JSON.stringify(first, null, 2));
    runInstaller(home);
    const second = readJson(mcpPath);
    assert.deepEqual(second.mcpServers["open-dynamic-workflows"].args, [
      resolve(root, "dist", "mcp", "server.js"),
    ]);
    assert.equal(
      Object.keys(second.mcpServers).filter((name) => name === "open-dynamic-workflows").length,
      1,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("Grok Bot installer keeps host identity and existing MCP entries", () => {
  const home = mkdtempSync(join(tmpdir(), "odw-grokbot-install-"));
  try {
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const path = join(home, ".cursor", "mcp.json");
    writeFileSync(path, JSON.stringify({ mcpServers: { other: { command: "keep" } } }));
    runInstaller(home, ["--host", "grok-bot"]);
    runInstaller(home, ["--host", "grok-bot"]);
    const config = readJson(path);
    assert.deepEqual(config.mcpServers.other, { command: "keep" });
    assert.equal(config.mcpServers["open-dynamic-workflows"].env.ODW_HOST, "grok-bot");
    const before = readFileSync(path, "utf8");
    const bad = spawnSync(process.execPath, [installer, "--home", home, "--host", "grok"], { encoding: "utf8" });
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /--host must be cursor or grok-bot/);
    assert.equal(readFileSync(path, "utf8"), before);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("installer refuses to follow a symlink-escape plugin-root", () => {
  const home = mkdtempSync(join(tmpdir(), "odw-cursor-cli-escape-"));
  const decoy = mkdtempSync(join(tmpdir(), "odw-cursor-cli-decoy-"));
  try {
    writeFileSync(join(decoy, "not-a-plugin"), "nope");
    const result = spawnSync(
      process.execPath,
      [installer, "--home", home, "--plugin-root", decoy],
      { cwd: root, encoding: "utf8" },
    );
    assert.notEqual(result.status, 0);
    assert.match(`${result.stderr}${result.stdout}`, /dist\/mcp\/server\.js/);
  } finally {
    rmSync(home, { recursive: true, force: true });
    rmSync(decoy, { recursive: true, force: true });
  }
});

test("CLI-written mcp.json can spawn the committed server (absolute path, ODW_HOST=cursor)", () => {
  const home = mkdtempSync(join(tmpdir(), "odw-cursor-cli-spawn-"));
  try {
    runInstaller(home);
    const mcp = readJson(join(home, ".cursor", "mcp.json"));
    const server = mcp.mcpServers["open-dynamic-workflows"];
    const child = spawnSync(
      server.command,
      server.args,
      {
        cwd: home,
        encoding: "utf8",
        env: { ...process.env, ...server.env },
        input:
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2024-11-05",
              capabilities: {},
              clientInfo: { name: "cursor-cli-test", version: "0" },
            },
          }) + "\n",
      },
    );
    assert.equal(child.status, 0, child.stderr);
    const line = child.stdout.trim().split(/\r?\n/).pop();
    const parsed = JSON.parse(line);
    assert.equal(parsed.result.serverInfo.name, "open-dynamic-workflows");
    assert.match(child.stderr, /host=cursor/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
