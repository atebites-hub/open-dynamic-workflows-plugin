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
const grokArgvOut = resolve(scratch, "grok-argv.json");
const sandboxMeta = {
  "codex/sandbox-state-meta": { sandboxCwd: pathToFileURL(workflowCwd).href },
};
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
writeFileSync(
  fakeGrok,
  `#!/usr/bin/env node
const fs = require("node:fs")
const args = process.argv.slice(2)
if (process.env.SMOKE_GROK_ARGV) {
  fs.writeFileSync(process.env.SMOKE_GROK_ARGV, JSON.stringify(args))
}
const fileIdx = args.indexOf("--prompt-file")
const prompt = fileIdx >= 0 && args[fileIdx + 1] ? fs.readFileSync(args[fileIdx + 1], "utf8") : ""
if (prompt.includes("WAIT_FOR_CANCEL")) {
  setInterval(() => {}, 1000)
  return
}
console.log(JSON.stringify({ type: "text", data: "ODW_FAKE_GROK_OK" }))
console.log(JSON.stringify({
  type: "end",
  stopReason: "end_turn",
  sessionId: "fake-grok-session",
  usage: { input_tokens: 4, output_tokens: 2, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  total_cost_usd: 0,
}))
`,
);
chmodSync(fakeGrok, 0o755);

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
const grokMarketplace = JSON.parse(
  readFileSync(resolve(root, ".grok-plugin", "marketplace.json"), "utf8"),
);
const grokPlugin = JSON.parse(readFileSync(resolve(root, ".grok-plugin", "plugin.json"), "utf8"));
const claudePlugin = JSON.parse(
  readFileSync(resolve(root, ".claude-plugin", "plugin.json"), "utf8"),
);
const zcodeMarketplace = JSON.parse(readFileSync(resolve(root, "marketplace.json"), "utf8"));
const mcpJson = JSON.parse(readFileSync(resolve(root, ".mcp.json"), "utf8"));

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
expect("Grok marketplace lists this repo as an installable plugin", () => {
  assert.equal(grokMarketplace.name, "open-dynamic-workflows");
  const plugin = grokMarketplace.plugins[0];
  assert.equal(plugin.name, "open-dynamic-workflows");
  assert.deepEqual(plugin.source, { type: "local", path: "./" });
  assert.ok(plugin.description.toLowerCase().includes("grok"));
  assert.ok(plugin.keywords.includes("grok-build"));
});
expect("Grok and Claude plugin manifests advertise grok", () => {
  assert.equal(grokPlugin.name, "open-dynamic-workflows");
  assert.match(grokPlugin.description, /Grok Build/);
  assert.match(claudePlugin.description, /Grok Build/);
  assert.ok(zcodeMarketplace.description.toLowerCase().includes("grok"));
});
expect("MCP launch config is plugin-relative and long-running", () => {
  const server = mcpJson.mcpServers["open-dynamic-workflows"];
  assert.equal(server.command, "node");
  assert.deepEqual(server.args, ["./scripts/run-mcp.cjs"]);
  assert.ok(server.timeoutMs >= 28800000);
  assert.ok(existsSync(resolve(root, "scripts", "run-mcp.cjs")));
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
    GROK_BIN: fakeGrok,
    SMOKE_GROK_ARGV: grokArgvOut,
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
  expect("workflow tool description mentions all bundled executors", () => {
    const d = list.result.tools[0].description;
    assert.ok(d.includes("agent("));
    assert.ok(d.includes("executor:'codex'"));
    assert.ok(d.includes("executor:'grok'"));
    assert.ok(d.includes("executor:'zcode'"));
    assert.ok(d.includes("/home/box/.grok/bin"));
    assert.ok(d.includes("meta"));
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
  expect("Grok leaf uses headless subprocess flags", () => {
    const argv = JSON.parse(readFileSync(grokArgvOut, "utf8"));
    assert.ok(argv.includes("--prompt-file"));
    assert.equal(argv[argv.indexOf("--output-format") + 1], "streaming-json");
    assert.equal(argv[argv.indexOf("--permission-mode") + 1], "acceptEdits");
    assert.ok(argv.includes("--no-subagents"));
    assert.ok(argv.includes("--no-auto-update"));
    assert.ok(argv.includes("--verbatim"));
    assert.equal(argv[argv.indexOf("--cwd") + 1], workflowCwd);
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

console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
