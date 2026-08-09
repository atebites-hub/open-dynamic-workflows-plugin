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

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";

const root = resolve(import.meta.dirname, "..");
const serverPath = resolve(root, "dist", "mcp", "server.js");

if (!existsSync(serverPath)) {
  console.error(`[smoke] ${serverPath} not found. Run \`node scripts/build.mjs\` first.`);
  process.exit(1);
}

// The smoke test runs in an empty cwd so a workflow can't clobber the plugin source.
// 冒烟测试在一个空 cwd 下运行，这样 workflow 不会误伤插件源码。
const { mkdtempSync } = await import("node:fs");
const { tmpdir } = await import("node:os");
const scratch = mkdtempSync(resolve(tmpdir(), "odw-smoke-"));

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
  env: { ...process.env, ZCODE_PROJECT_DIR: scratch },
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

  console.log("\n[smoke] tools/list…");
  framedWrite(proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const list = await waitForMessage((m) => m.id === 2);
  expect("tools/list exposes exactly one tool named 'workflow'", () => {
    assert.equal(list.result.tools.length, 1);
    assert.equal(list.result.tools[0].name, "workflow");
  });
  expect("workflow tool description mentions agent()/executor/meta", () => {
    const d = list.result.tools[0].description;
    assert.ok(d.includes("agent("));
    assert.ok(d.includes("executor"));
    assert.ok(d.includes("meta"));
  });

  console.log("\n[smoke] tools/call workflow (trivial script returning a value)…");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 3,
    method: "tools/call",
    params: {
      name: "workflow",
      arguments: {
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
  });

  console.log("\n[smoke] tools/call workflow (missing script + scriptPath → isError)");
  framedWrite(proc, {
    jsonrpc: "2.0",
    id: 4,
    method: "tools/call",
    params: { name: "workflow", arguments: {} },
  });
  const errCall = await waitForMessage((m) => m.id === 4);
  expect("missing-script returns isError", () => assert.equal(errCall.result.isError, true));
} catch (err) {
  failed++;
  console.error(`[smoke] fatal: ${err.message}`);
  console.error(stderrLines.join(""));
} finally {
  proc.kill();
}

console.log(`\n[smoke] ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
