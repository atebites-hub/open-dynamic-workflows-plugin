// scripts/install-cursor-cli.test.mjs — Cursor CLI installer (no Customize UI).
//
// The installer must produce a working ~/.cursor/mcp.json for `agent mcp list`
// without relying on ${PLUGIN_ROOT} (CLI user MCP config does not expand it).

import assert from "node:assert/strict";
import { lstatSync, readlinkSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

import {
  installCursorCli,
  mcpConfigPath,
  pluginDir,
  skillDir,
} from "./install-cursor-cli.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function makeSourceTree() {
  const source = await mkdtemp(join(tmpdir(), "odw-cli-source-"));
  const server = join(source, "dist", "mcp", "server.js");
  await mkdir(dirname(server), { recursive: true });
  await writeFile(
    server,
    "#!/usr/bin/env node\nprocess.stderr.write('fake-odw-mcp\\n');\nprocess.stdin.resume();\n",
  );
  await mkdir(join(source, "skills", "open-dynamic-workflows"), { recursive: true });
  await writeFile(
    join(source, "skills", "open-dynamic-workflows", "SKILL.md"),
    "---\nname: open-dynamic-workflows\ndescription: authoring\n---\n# skill\n",
  );
  await mkdir(join(source, "commands"), { recursive: true });
  await writeFile(join(source, "commands", "workflows.md"), "# workflows\n");
  await mkdir(join(source, ".cursor-plugin"), { recursive: true });
  await writeFile(
    join(source, ".cursor-plugin", "plugin.json"),
    JSON.stringify({ name: "open-dynamic-workflows", mcpServers: "./mcp.json" }),
  );
  await writeFile(
    join(source, "plugin.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
      name: "open-dynamic-workflows",
    }),
  );
  await writeFile(
    join(source, "mcp.json"),
    JSON.stringify({
      $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
      mcpServers: {
        "open-dynamic-workflows": {
          type: "stdio",
          command: "node",
          args: ["${PLUGIN_ROOT}/dist/mcp/server.js"],
          env: { ODW_HOST: "cursor" },
        },
      },
    }),
  );
  return source;
}

test("installCursorCli writes absolute MCP config, local plugin, and user skill", async () => {
  const source = await makeSourceTree();
  const home = await mkdtemp(join(tmpdir(), "odw-cli-home-"));
  try {
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          other: { command: "echo", args: ["ok"] },
        },
      }),
    );

    const result = await installCursorCli({ home, sourceRoot: source });
    const dest = pluginDir(home);
    const skill = skillDir(home);
    const mcpPath = mcpConfigPath(home);
    assert.equal(result.pluginDir, dest);
    assert.equal(result.skillDir, skill);
    assert.equal(result.mcpPath, mcpPath);

    const installedServer = join(dest, "dist", "mcp", "server.js");
    assert.equal(result.serverPath, installedServer);
    const serverJs = await readFile(installedServer, "utf8");
    assert.match(serverJs, /fake-odw-mcp/);
    assert.equal(
      await readFile(join(skill, "SKILL.md"), "utf8"),
      await readFile(join(source, "skills", "open-dynamic-workflows", "SKILL.md"), "utf8"),
    );
    assert.equal(
      JSON.parse(await readFile(join(dest, "plugin.json"), "utf8")).$schema,
      "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    );
    assert.equal(
      JSON.parse(await readFile(join(dest, ".cursor-plugin", "plugin.json"), "utf8")).name,
      "open-dynamic-workflows",
    );

    const mcp = JSON.parse(await readFile(mcpPath, "utf8"));
    assert.deepEqual(mcp.mcpServers.other, { command: "echo", args: ["ok"] });
    const server = mcp.mcpServers["open-dynamic-workflows"];
    assert.equal(server.command, "node");
    assert.deepEqual(server.args, [installedServer]);
    assert.ok(isAbsolute(server.args[0]));
    assert.equal(JSON.stringify(server).includes("${PLUGIN_ROOT}"), false);
    assert.equal(server.env.ODW_HOST, "cursor");
    assert.equal(server.env.CURSOR_PLUGIN_ROOT, dest);
    assert.ok(!Object.hasOwn(server, "cwd"), "do not pin cwd to the plugin install dir");
    assert.match(result.nextSteps, /agent mcp enable open-dynamic-workflows/);
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("installCursorCli is idempotent and replaces a stale PLUGIN_ROOT user config", async () => {
  const source = await makeSourceTree();
  const home = await mkdtemp(join(tmpdir(), "odw-cli-home-"));
  try {
    await mkdir(join(home, ".cursor"), { recursive: true });
    await writeFile(
      join(home, ".cursor", "mcp.json"),
      JSON.stringify({
        mcpServers: {
          "open-dynamic-workflows": {
            command: "node",
            args: ["${PLUGIN_ROOT}/dist/mcp/server.js"],
            env: { ODW_HOST: "cursor" },
          },
        },
      }),
    );
    await installCursorCli({ home, sourceRoot: source });
    const first = JSON.parse(await readFile(mcpConfigPath(home), "utf8"));
    await installCursorCli({ home, sourceRoot: source });
    const second = JSON.parse(await readFile(mcpConfigPath(home), "utf8"));
    assert.deepEqual(first, second);
    assert.equal(JSON.stringify(second).includes("${PLUGIN_ROOT}"), false);
    assert.ok(isAbsolute(second.mcpServers["open-dynamic-workflows"].args[0]));
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("installCursorCli --link symlinks the checkout for local plugin-dir use", async () => {
  const source = await makeSourceTree();
  const home = await mkdtemp(join(tmpdir(), "odw-cli-home-"));
  try {
    const result = await installCursorCli({ home, sourceRoot: source, link: true });
    const dest = pluginDir(home);
    assert.ok(lstatSync(dest).isSymbolicLink());
    assert.equal(resolve(readlinkSync(dest)), resolve(source));
    const server = JSON.parse(await readFile(mcpConfigPath(home), "utf8")).mcpServers[
      "open-dynamic-workflows"
    ];
    assert.equal(server.args[0], join(dest, "dist", "mcp", "server.js"));
    assert.equal(result.serverPath, join(dest, "dist", "mcp", "server.js"));
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});

test("CLI entrypoint honors --home and --source", async () => {
  const source = await makeSourceTree();
  const home = await mkdtemp(join(tmpdir(), "odw-cli-home-"));
  try {
    const child = spawn(
      process.execPath,
      [
        join(repoRoot, "scripts", "install-cursor-cli.mjs"),
        "--home",
        home,
        "--source",
        source,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const [stdout, stderr] = await Promise.all([
      new Promise((resolveStdout) => {
        let out = "";
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk) => {
          out += chunk;
        });
        child.stdout.on("end", () => resolveStdout(out));
      }),
      new Promise((resolveStderr) => {
        let err = "";
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk) => {
          err += chunk;
        });
        child.stderr.on("end", () => resolveStderr(err));
      }),
    ]);
    const code = await new Promise((resolveCode) => child.on("close", resolveCode));
    assert.equal(code, 0, stderr);
    assert.match(stdout, /agent mcp enable open-dynamic-workflows/);
    const mcp = JSON.parse(await readFile(mcpConfigPath(home), "utf8"));
    assert.equal(mcp.mcpServers["open-dynamic-workflows"].env.ODW_HOST, "cursor");
  } finally {
    await rm(source, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
});
