import assert from "node:assert/strict";
import { chmod, cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { delimiter, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";

import { defaultExecutorForHost, detectHost, isGrokHost, nativeOrchestrationAdvice } from "./host.ts";

test("Grok Bot preserves host identity but defaults to Cursor, not Grok Build", () => {
  const env = { ODW_HOST: "grok-bot", GROK_PLUGIN_ROOT: "/g", ODW_REQUIRE_CWD: "1" };
  assert.equal(detectHost(env), "grok-bot");
  assert.equal(defaultExecutorForHost(env), "cursor");
  assert.equal(isGrokHost(env), false);
  assert.equal(nativeOrchestrationAdvice("grok-bot"), undefined);
  assert.equal(nativeOrchestrationAdvice("cursor"), undefined);
  assert.equal(detectHost({ ODW_HOST: "unknown", PLUGIN_ROOT: "/p" }), undefined);
});

test("ODW_HOST wins over other signals", () => {
  assert.equal(
    defaultExecutorForHost({
      ODW_HOST: "grok",
      ODW_REQUIRE_CWD: "1",
      ZCODE_PLUGIN_ROOT: "/z",
    }),
    "grok",
  );
  assert.equal(defaultExecutorForHost({ ODW_HOST: "zcode" }), "zcode");
  assert.equal(defaultExecutorForHost({ ODW_HOST: "codex" }), "codex");
  assert.equal(defaultExecutorForHost({ ODW_HOST: "claude" }), "claude");
  assert.equal(defaultExecutorForHost({ ODW_HOST: "cursor" }), "cursor");
  assert.equal(defaultExecutorForHost({ ODW_HOST: "antigravity" }), "antigravity");
  assert.equal(defaultExecutorForHost({ ODW_HOST: "copilot" }), "copilot");
  assert.match(nativeOrchestrationAdvice("claude")!, /ultracode/);
  assert.match(nativeOrchestrationAdvice("codex")!, /ultra mode/);
  assert.equal(nativeOrchestrationAdvice("antigravity"), undefined);
});

test("Codex ODW_REQUIRE_CWD maps to codex before plugin-root aliases", () => {
  assert.equal(defaultExecutorForHost({ ODW_REQUIRE_CWD: "1" }), "codex");
  assert.equal(
    defaultExecutorForHost({
      ODW_REQUIRE_CWD: "1",
      CLAUDE_PLUGIN_ROOT: "/c",
    }),
    "codex",
  );
});

test("plugin-root env maps to the matching CLI; Grok beats the Claude alias", () => {
  assert.equal(defaultExecutorForHost({ GROK_PLUGIN_ROOT: "/g" }), "grok");
  assert.equal(
    defaultExecutorForHost({
      GROK_PLUGIN_ROOT: "/g",
      CLAUDE_PLUGIN_ROOT: "/c",
    }),
    "grok",
  );
  assert.equal(defaultExecutorForHost({ ZCODE_PLUGIN_ROOT: "/z" }), "zcode");
  assert.equal(defaultExecutorForHost({ CLAUDE_PLUGIN_ROOT: "/c" }), "claude");
  assert.equal(defaultExecutorForHost({ CURSOR_PLUGIN_ROOT: "/cur" }), "cursor");
  assert.equal(defaultExecutorForHost({ PLUGIN_ROOT: "/p" }), "cursor");
});

test("unknown host has no default", () => {
  assert.equal(defaultExecutorForHost({}), undefined);
  assert.equal(defaultExecutorForHost({ ODW_HOST: "nope" }), undefined);
  assert.equal(defaultExecutorForHost({ ODW_HOST: "nope", GROK_PLUGIN_ROOT: "/g" }), undefined);
  assert.equal(isGrokHost({ GROK_PLUGIN_ROOT: "/g" }), true);
  assert.equal(isGrokHost({ ZCODE_PLUGIN_ROOT: "/z" }), false);
});

test("the shared ODW leaf marker suppresses nested workflow tools", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const server = join(root, "dist", "mcp", "server.js");
  const child = spawn(process.execPath, [server], {
    cwd: root,
    env: { ...process.env, ODW_HOST: "cursor", ODW_CURSOR_LEAF: "", ODW_LEAF: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  const request = (id: number, method: string, params?: Record<string, unknown>) =>
    new Promise<any>((resolveRequest, reject) => {
      const body = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
      child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
      const deadline = setTimeout(() => reject(new Error("nested leaf MCP timed out")), 10_000);
      const check = () => {
        const match = /Content-Length:\s*(\d+)\r\n\r\n([\s\S]*)/i.exec(output);
        if (!match) return;
        const length = Number(match[1]);
        if (Buffer.byteLength(match[2]) < length) return;
        clearTimeout(deadline);
        child.stdout.off("data", check);
        const framed = match[2].slice(0, length);
        output = match[2].slice(length);
        resolveRequest(JSON.parse(framed));
      };
      child.stdout.on("data", check);
      check();
    });
  try {
    await request(1, "initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "nested-leaf", version: "0" },
    });
    const listed = await request(2, "tools/list");
    assert.deepEqual(listed.result.tools, []);
  } finally {
    child.kill();
  }
});

test("each supported host starts the MCP server and launches its native executor", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const server = join(root, "dist", "mcp", "server.js");
  const directory = await mkdtemp(join(tmpdir(), "odw-host-startup-"));
  const fake = join(directory, "fake-cli");
  const launchLog = join(directory, "launch.log");
  await writeFile(fake, `#!/usr/bin/env node
const kind = process.env.ODW_FAKE_KIND;
if (process.env.ODW_FAKE_LAUNCH_LOG) require("node:fs").appendFileSync(process.env.ODW_FAKE_LAUNCH_LOG, kind + "\\n");
const finish = () => {
  if (kind === "antigravity") {
    console.log(JSON.stringify({event:"result",result:{status:"SUCCESS",response:"HOST_OK",conversation_id:"fake"}}));
  } else if (kind === "copilot") {
    console.log(JSON.stringify({type:"assistant.message",data:{content:"HOST_OK"}}));
    console.log(JSON.stringify({type:"result",exitCode:0,sessionId:"fake"}));
  } else if (kind === "codex") {
    console.log(JSON.stringify({type:"thread.started",thread_id:"fake-thread"}));
    console.log(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:"HOST_OK"}}));
    console.log(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1}}));
  } else if (kind === "claude") {
    console.log(JSON.stringify({type:"assistant",message:{content:[{type:"text",text:"HOST_OK"}]}}));
    console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"HOST_OK",session_id:"fake"}));
  } else if (kind === "zcode") {
    console.log(JSON.stringify({type:"zcode_result",text:"HOST_OK",stderr:"",exitCode:0,sessionId:"fake",costUsd:null,inputTokens:null,outputTokens:null,totalTokens:null,telemetryAvailable:false}));
  } else if (kind === "grok") {
    console.log(JSON.stringify({text:"HOST_OK",stopReason:"end_turn",sessionId:"fake",requestId:"fake"}));
  } else {
    console.log(JSON.stringify({type:"result",subtype:"success",is_error:false,result:"HOST_OK",session_id:"fake"}));
  }
};
finish();
  `);
  await chmod(fake, 0o755);
  await cp(fake, join(directory, "codex"));
  await cp(fake, join(directory, "claude"));
  const hosts = [
    ["codex", "codex"],
    ["cursor", "cursor"],
    ["grok-bot", "cursor"],
    ["claude", "claude"],
    ["grok", "grok"],
    ["zcode", "zcode"],
    ["antigravity", "antigravity"],
    ["copilot", "copilot"],
    ["invalid", "invalid"],
  ] as const;
  const launchCount = async () => {
    try {
      return (await readFile(launchLog, "utf8")).split("\n").filter(Boolean).length;
    } catch {
      return 0;
    }
  };
  try {
    for (const [host, kind] of hosts) {
      const launchesBefore = await launchCount();
      const child = spawn(process.execPath, [server], {
        cwd: directory,
        env: {
          ...process.env,
          ODW_HOST: host,
          ODW_FAKE_KIND: kind,
          ODW_FAKE_LAUNCH_LOG: launchLog,
          PATH: `${directory}${delimiter}${process.env.PATH ?? ""}`,
          ...(kind === "cursor" ? { CURSOR_BIN: fake } : {}),
          ...(host === "grok" ? { GROK_BIN: fake } : {}),
          ...(host === "zcode" ? { ZCODE_BIN: fake } : {}),
          ...(host === "antigravity" ? { ANTIGRAVITY_BIN: fake } : {}),
          ...(host === "copilot" ? { COPILOT_BIN: fake } : {}),
          ...(host === "codex" ? { ODW_REQUIRE_CWD: "1" } : {}),
        },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.stderr.setEncoding("utf8");
      const request = (id: number, method: string, params?: Record<string, unknown>) => new Promise<any>((resolveRequest, reject) => {
        const body = JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
        child.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        const deadline = setTimeout(() => reject(new Error(`${host} MCP startup timed out`)), 10_000);
        const check = () => {
          const match = /Content-Length:\s*(\d+)\r\n\r\n([\s\S]*)/i.exec(output);
          if (!match) return;
          const length = Number(match[1]);
          if (Buffer.byteLength(match[2]) < length) return;
          clearTimeout(deadline);
          child.stdout.off("data", check);
          const body = match[2].slice(0, length);
          output = match[2].slice(length);
          resolveRequest(JSON.parse(body));
        };
        child.stdout.on("data", check);
        check();
      });
      await request(1, "initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "host-test", version: "0" } });
      const listed = await request(2, "tools/list");
      const nativeOnly = host === "claude" || host === "codex";
      assert.equal(listed.result.tools.length, nativeOnly ? 0 : 1, `${host} advertised the wrong tools`);
      if (host === "grok-bot") {
        for (const [id, cwd] of [[4, undefined], [5, "relative/path"]] as const) {
          const rejected = await request(id, "tools/call", {
            name: "workflow",
            arguments: { ...(cwd === undefined ? {} : { cwd }), script: "export const meta={name:'bad-bot-cwd',description:'no launch'}; return await agent('no');" },
          });
          assert.equal(rejected.result.isError, true);
          assert.match(rejected.result.content[0].text, /absolute/);
          assert.equal(await launchCount(), launchesBefore, "invalid Bot cwd launched a worker");
        }
      }
      const call = await request(3, "tools/call", {
        name: "workflow",
        ...(host === "codex" ? { _meta: { "codex/sandbox-state-meta": { sandboxCwd: `file://${directory}` } } } : {}),
        arguments: {
          cwd: directory,
          script: `export const meta = { name: 'host-${host}', description: 'host startup' }\nreturn await agent('ok')\n`,
        },
      });
      if (nativeOnly) {
        assert.equal(call.result.isError, true);
        assert.match(call.result.content[0].text, host === "claude" ? /ultracode/ : /ultra mode/);
        assert.equal(await launchCount(), launchesBefore, "native-only host launched an ODW worker");
      } else if (host === "invalid") {
        assert.equal(call.result.isError, true, "invalid ODW_HOST must reject omitted executor");
        assert.equal(await launchCount(), launchesBefore, "invalid host launched a subprocess");
      } else {
        assert.equal(call.result.isError, false, `${host} startup call failed`);
        const summary = JSON.parse(call.result.content[0].text);
        assert.equal(summary.value, "HOST_OK", `${host} selected the wrong executor`);
        assert.deepEqual(summary.executionContext, { host, defaultExecutor: kind });
        assert.equal(await launchCount(), launchesBefore + 1, `${host} did not launch its native executor`);
      }
      child.kill();
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
