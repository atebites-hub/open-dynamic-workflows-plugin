// scripts/smoke.mjs — standalone smoke test for the built MCP server.
// scripts/smoke.mjs —— 构建产物 MCP server 的独立冒烟测试。
//
// Pipes JSON-RPC initialize / tools/list / tools/call lines into the built server over
// stdio and asserts the responses — the same pattern documented in the zcode example-plugin
// README's "Manual smoke test" section, codified as a runnable script.
// 通过 stdio 把 JSON-RPC initialize / tools/list / tools/call 行喂给构建好的 server，
// 并断言响应——与 zcode example-plugin README "Manual smoke test" 一节里记录的模式相同，
// 这里固化成可运行的脚本。
//
// Run AFTER `node scripts/build.mjs` (or `npm run setup`).
// 在 `node scripts/build.mjs`（或 `npm run setup`）之后运行。

import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const serverPath = resolve(root, "dist", "mcp", "server.js");

if (!existsSync(serverPath)) {
  console.error(`[smoke] ${serverPath} not found. Run \`node scripts/build.mjs\` first.`);
  process.exit(1);
}

// The smoke test runs in an empty cwd so a workflow can't clobber the plugin source.
// 冒烟测试在一个空 cwd 下运行，这样 workflow 不会误伤插件源码。
const { tmpdir } = await import("node:os");
const scratch = mkdtempSync(resolve(tmpdir(), "odw-smoke-"));
const workflowCwd = mkdtempSync(resolve(tmpdir(), "odw-workflow-"));
const fakeBin = mkdtempSync(resolve(tmpdir(), "odw-bin-"));
const fakeCodex = resolve(fakeBin, "codex");
const fakeGrok = resolve(fakeBin, "grok");
const fakeZcode = resolve(fakeBin, "zcode");
const sandboxMeta = {
  "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(workflowCwd).href },
};
writeFileSync(
  fakeGrok,
  `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes("--tools")) {
  console.error("refusing --tools allowlist");
  process.exit(2);
}
let format = "plain";
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--output-format") format = args[i + 1] || format;
}
if (format === "json") {
  console.log(JSON.stringify({
    text: "ODW_FAKE_GROK_OK",
    stopReason: "end_turn",
    sessionId: "fake-grok-session",
    requestId: "fake-req",
  }));
} else {
  console.log(JSON.stringify({ type: "text", data: "ODW_FAKE_GROK_OK" }));
  console.log(JSON.stringify({
    type: "end",
    stopReason: "end_turn",
    sessionId: "fake-grok-session",
    requestId: "fake-req",
  }));
}
`,
);
chmodSync(fakeGrok, 0o755);
writeFileSync(
  fakeZcode,
  `#!/usr/bin/env node
console.log(JSON.stringify({
  type: "zcode_result",
  text: "ODW_FAKE_ZCODE_OK",
  stderr: "",
  exitCode: 0,
  sessionId: "fake-zcode-session",
  costUsd: null,
  inputTokens: null,
  outputTokens: null,
  totalTokens: null,
  telemetryAvailable: false,
}))
`,
);
chmodSync(fakeZcode, 0o755);
writeFileSync(
  fakeCodex,
  `#!/usr/bin/env node
let prompt = ""
process.stdin.on("data", chunk => { prompt += chunk })
process.stdin.resume()
process.stdin.on("end", () => {
  if (prompt.includes("WAIT_FOR_CANCEL")) return setInterval(() => {}, 1000)
  console.log(JSON.stringify({ type: "thread.started", thread_id: "fake-thread" }))
  console.log(JSON.stringify({ type: "item.completed", item: { id: "fake-item", type: "agent_message", text: "ODW_FAKE_CODEX_OK" } }))
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 3, cached_input_tokens: 0, output_tokens: 1, reasoning_output_tokens: 0 } }))
})
`,
);
chmodSync(fakeCodex, 0o755);

let passed = 0;
let failed = 0;

function expect(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${name}: ${err.message}`);
  }
}

const codexManifest = JSON.parse(
  readFileSync(resolve(root, ".codex-plugin", "plugin.json"), "utf8"),
);
const codexMcp = JSON.parse(readFileSync(resolve(root, ".codex-mcp.json"), "utf8"));
const codexMarketplace = JSON.parse(
  readFileSync(resolve(root, ".agents", "plugins", "marketplace.json"), "utf8"),
);

expect("Codex manifest registers the skill and MCP server", () => {
  assert.equal(codexManifest.name, "open-dynamic-workflows");
  assert.equal(codexManifest.skills, "./skills/");
  assert.equal(codexManifest.mcpServers, "./.codex-mcp.json");
});
expect("Codex MCP command is plugin-relative", () => {
  const server = codexMcp.mcpServers["open-dynamic-workflows"];
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["./dist/mcp/server.js"]);
  assert.equal(server.cwd, ".");
  assert.equal(server.env.ODW_REQUIRE_CWD, "1");
  assert.equal(server.tool_timeout_sec, 28800);
});
expect("Codex marketplace exposes this repository as the plugin", () => {
  const plugin = codexMarketplace.plugins[0];
  assert.equal(plugin.name, "open-dynamic-workflows");
  assert.deepEqual(plugin.source, { source: "local", path: "./" });
});

const grokMarketplace = JSON.parse(
  readFileSync(resolve(root, ".grok-plugin", "marketplace.json"), "utf8"),
);
const grokPlugin = JSON.parse(
  readFileSync(resolve(root, ".grok-plugin", "plugin.json"), "utf8"),
);
const grokMcp = JSON.parse(
  readFileSync(resolve(root, ".grok-plugin", "mcp.json"), "utf8"),
);
const rootMcp = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));

expect("Grok marketplace names this plugin with a local source", () => {
  const plugin = grokMarketplace.plugins[0];
  assert.equal(plugin.name, "open-dynamic-workflows");
  assert.deepEqual(plugin.source, {
    type: "local",
    path: "./plugins/open-dynamic-workflows",
  });
});
expect("Grok marketplace plugin package has skill, command, and MCP bundle", () => {
  const pkg = resolve(root, "plugins", "open-dynamic-workflows");
  assert.ok(existsSync(resolve(pkg, ".grok-plugin", "plugin.json")));
  assert.ok(existsSync(resolve(pkg, ".grok-plugin", "mcp.json")));
  assert.ok(existsSync(resolve(pkg, "skills", "open-dynamic-workflows", "SKILL.md")));
  assert.ok(existsSync(resolve(pkg, "commands", "workflows.md")));
  assert.ok(existsSync(resolve(pkg, "dist", "mcp", "server.js")));
});
expect("Grok plugin manifest points at a Grok-resolvable MCP config", () => {
  assert.equal(grokPlugin.name, "open-dynamic-workflows");
  assert.equal(grokPlugin.mcpServers, "./.grok-plugin/mcp.json");
});
expect("Grok MCP launch uses GROK_PLUGIN_ROOT and a long tool timeout", () => {
  const server = grokMcp.mcpServers["open-dynamic-workflows"];
  const packaged = JSON.parse(
    readFileSync(resolve(root, "plugins", "open-dynamic-workflows", ".grok-plugin", "mcp.json"), "utf8"),
  ).mcpServers["open-dynamic-workflows"];
  for (const cfg of [server, packaged]) {
    assert.equal(cfg.command, "node");
    assert.ok(
      cfg.args.some((a) => String(a).includes("${GROK_PLUGIN_ROOT}")),
      "Grok MCP args must expand GROK_PLUGIN_ROOT",
    );
    assert.ok(
      !JSON.stringify(cfg).includes("${ZCODE_PLUGIN_ROOT}"),
      "Grok MCP must not depend on ZCODE_PLUGIN_ROOT",
    );
    assert.ok(
      !Object.hasOwn(cfg, "cwd"),
      "Grok MCP must not pin cwd (inherit the session project, not GROK_PLUGIN_ROOT)",
    );
    assert.equal(cfg.tool_timeout_sec, 28800);
    assert.equal(cfg.env.ODW_HOST, "grok");
  }
});
expect("root ZCode MCP launch still uses ZCODE_PLUGIN_ROOT", () => {
  const server = rootMcp.mcpServers["open-dynamic-workflows"];
  assert.ok(server.args.some((a) => String(a).includes("${ZCODE_PLUGIN_ROOT}")));
});
expect("authoring skill and /workflows command are present", () => {
  assert.ok(existsSync(resolve(root, "skills", "open-dynamic-workflows", "SKILL.md")));
  assert.ok(existsSync(resolve(root, "commands", "workflows.md")));
});

// Send one JSON-RPC line per request, collect the framed responses. The server speaks
// Content-Length framing, but for a smoke test we read its stdout as a stream of framed
// messages and decode them.
// 每个请求发一行 JSON-RPC，收集分帧响应。server 用 Content-Length 分帧，但冒烟测试里
// 我们把它的 stdout 当作一串分帧消息流读取并解码。
function framedWrite(proc, obj) {
  const body = JSON.stringify(obj);
  proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

function readFramed(buf) {
  const out = [];
  let i = 0;
  while (true) {
    const headerEnd = buf.indexOf("\r\n\r\n");
    if (headerEnd === -1) break;
    const header = buf.slice(0, headerEnd).toString("utf8");
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    if (!m) break;
    const len = Number(m[1]);
    const start = headerEnd + 4;
    if (buf.length < start + len) break;
    const body = buf.slice(start, start + len).toString("utf8");
    out.push(JSON.parse(body));
    i = start + len;
    buf = buf.slice(i);
  }
  return { messages: out, rest: buf };
}

const proc = spawn(process.execPath, [serverPath], {
  cwd: scratch,
  env: {
    ...process.env,
    ODW_REQUIRE_CWD: "1",
    PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
    ZCODE_PROJECT_DIR: scratch,
  },
  stdio: ["pipe", "pipe", "pipe"],
});

let stdoutBuf = Buffer.alloc(0);
const stderrLines = [];
proc.stdout.on("data", (c) => (stdoutBuf = Buffer.concat([stdoutBuf, c])));
proc.stderr.on("data", (c) => stderrLines.push(c.toString()));

function waitForMessage(predicate, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout waiting for message")), timeoutMs);
    const check = () => {
      const { messages, rest } = readFramed(stdoutBuf);
      const hit = messages.find(predicate);
      if (hit) {
        clearTimeout(t);
        proc.stdout.off("data", check);
        stdoutBuf = rest;
        resolve(hit);
      }
    };
    proc.stdout.on("data", check);
    check();
  });
}

try {
  console.log("\n[smoke] initialize…");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
  });
  const init = await waitForMessage((m) => m.id === 1);
  expect("initialize returns serverInfo.name", () =>
    assert.equal(init.result.serverInfo.name, "open-dynamic-workflows"),
  );
  expect("initialize requests Codex sandbox metadata", () =>
    assert.deepEqual(init.result.capabilities.experimental["codex/sandbox-state-meta"], {}),
  );

  console.log("\n[smoke] tools/list…");
  framedWrite(proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitForMessage((m) => m.id === 2);
  expect("tools/list exposes exactly one tool named 'workflow'", () => {
    assert.equal(list.result.tools.length, 1);
    assert.equal(list.result.tools[0].name, "workflow");
  });
  expect("workflow tool description names zcode first and still names grok/codex", () => {
    const d = list.result.tools[0].description;
    assert.ok(d.includes("agent("));
    assert.ok(d.includes("executor:'grok'"));
    assert.ok(d.includes("executor:'codex'"));
    assert.ok(d.includes("executor:'zcode'"));
    assert.ok(d.includes("meta"));
    assert.match(d, /omits executor runs on zcode/);
    const grokAt = d.indexOf("executor:'grok'");
    const codexAt = d.indexOf("executor:'codex'");
    const zcodeAt = d.indexOf("executor:'zcode'");
    assert.ok(zcodeAt >= 0 && zcodeAt < grokAt && zcodeAt < codexAt);
  });

  console.log("\n[smoke] tools/call workflow (trivial script returning a value)…");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: workflowCwd,
        script:
          "export const meta = { name: 'smoke', description: 'trivial' }\nreturn { ok: true, n: 42 }\n",
      },
    },
  });
  const call = await waitForMessage((m) => m.id === 3, 30000);
  expect("workflow tool call resolves (not error)", () => assert.equal(call.result?.isError, false));
  expect("returned value is the script's return object", () => {
    const parsed = JSON.parse(call.result.content[0].text);
    assert.deepEqual(parsed.value, { ok: true, n: 42 });
    assert.equal(parsed.ok, true);
    assert.equal(parsed.agentCount, 0);
    assert.ok(existsSync(resolve(workflowCwd, ".odw", "smoke", "runs", parsed.runId)));
  });

  console.log("\n[smoke] tools/call workflow (Codex leaf through bundled executor)…");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: workflowCwd,
        script:
          "export const meta = { name: 'codex-leaf', description: 'one fake Codex leaf' }\n" +
          "return await agent('Reply with OK only.', { executor: 'codex', label: 'codex' })\n",
      },
    },
  });
  const codexCall = await waitForMessage((m) => m.id === 4, 30000);
  expect("Codex leaf executes through the bundled registry", () => {
    const parsed = JSON.parse(codexCall.result.content[0].text);
    assert.equal(codexCall.result.isError, false);
    assert.equal(parsed.value, "ODW_FAKE_CODEX_OK");
    assert.equal(parsed.agentCount, 1);
    assert.equal(parsed.failedAgents, 0);
  });

  console.log("\n[smoke] tools/call workflow (Grok leaf through bundled executor)…");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 13,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: workflowCwd,
        script:
          "export const meta = { name: 'grok-leaf', description: 'one fake Grok leaf' }\n" +
          "return await agent('Reply with OK only.', { executor: 'grok', label: 'grok' })\n",
      },
    },
  });
  const grokCall = await waitForMessage((m) => m.id === 13, 30000);
  expect("Grok leaf executes through the bundled registry", () => {
    const parsed = JSON.parse(grokCall.result.content[0].text);
    assert.equal(grokCall.result.isError, false);
    assert.equal(parsed.value, "ODW_FAKE_GROK_OK");
    assert.equal(parsed.agentCount, 1);
    assert.equal(parsed.failedAgents, 0);
  });

  console.log("\n[smoke] Codex host still requires an explicit executor");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 14,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: workflowCwd,
        script:
          "export const meta = { name: 'need-exec', description: 'omit executor' }\n" +
          "return await agent('no executor on Codex host')\n",
      },
    },
  });
  const missingExec = await waitForMessage((m) => m.id === 14, 30000);
  expect("Codex host omitted-executor still fails", () => {
    assert.equal(missingExec.result.isError, true);
    assert.match(missingExec.result.content[0].text, /executor/i);
  });

  console.log("\n[smoke] tools/call workflow (missing script + scriptPath → isError)");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 5,
    method: "tools/call",
    params: { name: "workflow", _meta: sandboxMeta, arguments: {} },
  });
  const errCall = await waitForMessage((m) => m.id === 5);
  expect("missing-script returns isError", () => assert.equal(errCall.result.isError, true));

  console.log("\n[smoke] tools/call workflow (Codex mode without cwd → isError)");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 6,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        script: "export const meta = { name: 'bad-cwd', description: 'trivial' }\nreturn true\n",
      },
    },
  });
  const cwdCall = await waitForMessage((m) => m.id === 6);
  expect("Codex mode requires an explicit cwd", () => {
    assert.equal(cwdCall.result.isError, true);
    assert.match(cwdCall.result.content[0].text, /require an absolute `cwd`/);
  });

  console.log("\n[smoke] tools/call workflow (non-string cwd → isError)");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 7,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: 42,
        script: "export const meta = { name: 'bad-cwd-type', description: 'trivial' }\nreturn true\n",
      },
    },
  });
  const cwdTypeCall = await waitForMessage((m) => m.id === 7);
  expect("non-string cwd returns an MCP tool error", () => {
    assert.equal(cwdTypeCall.result.isError, true);
    assert.match(cwdTypeCall.result.content[0].text, /must be an absolute project path/);
  });

  console.log("\n[smoke] notifications/cancelled aborts an active Codex leaf");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 8,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: workflowCwd,
        script:
          "export const meta = { name: 'cancel', description: 'cancel one leaf' }\n" +
          "return await agent('WAIT_FOR_CANCEL', { executor: 'codex', label: 'cancel' })\n",
      },
    },
  });
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 50));
  framedWrite(proc, {
    jsonrpc: "2.0",
    method: "notifications/cancelled",
    params: { requestId: 8, reason: "smoke cancellation" },
  });
  const cancelledCall = await waitForMessage((m) => m.id === 8, 5000);
  expect("cancelled workflow returns an actionable tool error", () => {
    assert.equal(cancelledCall.result.isError, true);
    assert.match(cancelledCall.result.content[0].text, /aborted/);
  });

  console.log("\n[smoke] tools/call rejects cwd outside the active Codex workspace");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 9,
    method: "tools/call",
    params: {
      name: "workflow",
      _meta: sandboxMeta,
      arguments: {
        cwd: scratch,
        script: "export const meta = { name: 'outside', description: 'trivial' }\nreturn true\n",
      },
    },
  });
  const outsideCall = await waitForMessage((m) => m.id === 9);
  expect("outside-workspace cwd returns an MCP tool error", () => {
    assert.equal(outsideCall.result.isError, true);
    assert.match(outsideCall.result.content[0].text, /must match the active Codex workspace/);
  });

  console.log("\n[smoke] tools/call rejects missing trusted Codex metadata");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 10,
    method: "tools/call",
    params: {
      name: "workflow",
      arguments: {
        cwd: workflowCwd,
        script: "export const meta = { name: 'untrusted', description: 'trivial' }\nreturn true\n",
      },
    },
  });
  const untrustedCall = await waitForMessage((m) => m.id === 10);
  expect("missing Codex sandbox metadata returns an MCP tool error", () => {
    assert.equal(untrustedCall.result.isError, true);
    assert.match(untrustedCall.result.content[0].text, /trusted workspace metadata/);
  });

  console.log("\n[smoke] malformed JSON-RPC input returns an error without killing the server");
  framedWrite(proc, null);
  const invalidRequest = await waitForMessage((m) => m.id === null && m.error?.code === -32600);
  expect("non-object JSON-RPC input returns Invalid Request", () =>
    assert.equal(invalidRequest.error.message, "Invalid Request"),
  );
  framedWrite(proc, { jsonrpc: "2.0", id: 11, method: "ping" });
  const ping = await waitForMessage((m) => m.id === 11);
  expect("server remains alive after malformed input", () => assert.deepEqual(ping.result, {}));
} catch (err) {
  failed++;
  console.error(`[smoke] fatal: ${err.message}`);
  console.error(stderrLines.join(""));
} finally {
  proc.kill();
}

const lineProtocol = spawnSync(process.execPath, [serverPath], {
  cwd: scratch,
  encoding: "utf8",
  env: { ...process.env, ODW_REQUIRE_CWD: "1" },
  input:
    JSON.stringify({
      jsonrpc: "2.0",
      id: 12,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "line-smoke", version: "0" },
      },
    }) + "\n",
});
expect("newline-delimited MCP clients receive a newline-delimited response", () => {
  const response = JSON.parse(lineProtocol.stdout.trim());
  assert.equal(response.id, 12);
  assert.equal(response.result.serverInfo.name, "open-dynamic-workflows");
});

console.log("\n[smoke] Grok-host omit-cwd uses spawn cwd, not plugin root…");
const grokProject = mkdtempSync(resolve(tmpdir(), "odw-grok-project-"));
const grokHostEnv = {
  ...process.env,
  PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
  GROK_PLUGIN_ROOT: root,
  ODW_HOST: "grok",
};
delete grokHostEnv.ODW_REQUIRE_CWD;
delete grokHostEnv.GROK_WORKSPACE_ROOT;
delete grokHostEnv.ZCODE_PROJECT_DIR;
delete grokHostEnv.CLAUDE_PROJECT_DIR;
delete grokHostEnv.ZCODE_BIN;
const grokHost = spawn(process.execPath, [serverPath], {
  cwd: grokProject,
  env: grokHostEnv,
  stdio: ["pipe", "pipe", "pipe"],
});
let grokHostBuf = Buffer.alloc(0);
const grokHostErr = [];
grokHost.stdout.on("data", (c) => (grokHostBuf = Buffer.concat([grokHostBuf, c])));
grokHost.stderr.on("data", (c) => grokHostErr.push(c.toString()));

function grokHostWait(predicate, timeoutMs = 15000) {
  return new Promise((resolveWait, rejectWait) => {
    const t = setTimeout(() => rejectWait(new Error("timeout waiting for grok-host message")), timeoutMs);
    const check = () => {
      const { messages, rest } = readFramed(grokHostBuf);
      const hit = messages.find(predicate);
      if (hit) {
        clearTimeout(t);
        grokHost.stdout.off("data", check);
        grokHostBuf = rest;
        resolveWait(hit);
      }
    };
    grokHost.stdout.on("data", check);
    check();
  });
}

function grokHostWrite(obj) {
  const body = JSON.stringify(obj);
  grokHost.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
}

try {
  grokHostWrite({
    jsonrpc: "2.0",
    id: 20,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "grok-host-smoke", version: "0" },
    },
  });
  await grokHostWait((m) => m.id === 20);
  grokHostWrite({
    jsonrpc: "2.0",
    id: 21,
    method: "tools/call",
    params: {
      name: "workflow",
      arguments: {
        script:
          "export const meta = { name: 'host-default', description: 'omit executor on grok host' }\n" +
          "return await agent('Reply with OK only.', { label: 'default-zcode' })\n",
      },
    },
  });
  const grokDefault = await grokHostWait((m) => m.id === 21, 30000);
  expect("Grok host omitted-executor uses zcode", () => {
    const parsed = JSON.parse(grokDefault.result.content[0].text);
    assert.equal(grokDefault.result.isError, false);
    assert.equal(parsed.value, "ODW_FAKE_ZCODE_OK");
    assert.equal(parsed.agentCount, 1);
  });
  expect("Grok omit-cwd writes .odw into the session project, not the plugin root", () => {
    const parsed = JSON.parse(grokDefault.result.content[0].text);
    assert.ok(
      existsSync(resolve(grokProject, ".odw", "host-default", "runs", parsed.runId)),
      "artifacts must land under the Grok MCP spawn cwd (user project)",
    );
    assert.ok(
      !existsSync(resolve(root, ".odw", "host-default", "runs", parsed.runId)),
      "artifacts must not land under GROK_PLUGIN_ROOT",
    );
  });
} catch (err) {
  failed++;
  console.error(`[smoke] grok-host fatal: ${err.message}`);
  console.error(grokHostErr.join(""));
} finally {
  grokHost.kill();
}

console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
