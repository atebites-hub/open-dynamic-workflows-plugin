// src/mcp/server.ts — the plugin's MCP server: exposes the `workflow` tool.
// src/mcp/server.ts —— 插件的 MCP server：暴露 `workflow` 工具。
//
// Structurally based on the zcode example-plugin's hello-server.mjs (zero-dep
// 结构上基于 zcode example-plugin 的 hello-server.mjs（零依赖的 stdio
// stdio JSON-RPC), but the single tool it exposes runs the ODW runtime:
// JSON-RPC），但它暴露的唯一工具运行 ODW 运行时：
//
//   workflow({ cwd?, script, args?, scriptPath?, resumeFromRunId? })
//     → runWorkflow({ ..., executors: { codex: codexExecutor, zcode: zcodeExecutor } })
//     → { content:[{type:"text", text: JSON.stringify(result.value)}], isError: !result.ok }
//
// The tool's `description` is the authoring guide condensed — the model learns to
// write workflow scripts from it (proven by the solar-system demo: a model authored a
// correct script using only the SKILL.md). This mirrors how Claude Code's built-in
// Workflow tool encodes its authoring contract in the tool description.
//
// Built by scripts/build.mjs via esbuild into a single self-contained dist/mcp/server.js
// (ODW + ajv inlined — no node_modules at runtime, matching every other zcode plugin).
//
// 由 scripts/build.mjs 经 esbuild 打包成单个自包含的 dist/mcp/server.js
//（ODW + ajv 内联——运行时无需 node_modules，与所有其它 zcode 插件一致）。

import {
  claudeExecutor,
  codexExecutor,
  grokExecutor,
  runWorkflow,
  zcodeExecutor,
} from "../../open-dynamic-workflows/dist/index.js";
import type { WorkflowResult } from "../../open-dynamic-workflows/dist/index.js";
import { realpath } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultExecutorForHost } from "./host.js";

const SERVER_INFO = {
  name: "open-dynamic-workflows",
  version: "0.2.0",
};

const EXECUTORS = {
  zcode: zcodeExecutor,
  grok: grokExecutor,
  claude: claudeExecutor,
  codex: codexExecutor,
};
const SANDBOX_META_KEY = "codex/sandbox-state-meta";
const DEFAULT_EXECUTOR = defaultExecutorForHost();
const NESTED_GROK_LEAF = process.env.ODW_GROK_LEAF === "1";

// The tool's `description` IS the authoring contract — the model reads it to learn how
// to write a workflow script. Keep it aligned with skills/open-dynamic-workflows/SKILL.md.
// 工具的 `description` 就是编写契约——模型读它来学习如何编写 workflow 脚本。
// 保持它与 skills/open-dynamic-workflows/SKILL.md 一致。
const WORKFLOW_TOOL = {
  name: "workflow",
  description: [
    "Execute a dynamic workflow script that orchestrates Grok, Claude, Codex, or ZCode subagents deterministically.",
    "A dynamic workflow is plain JavaScript (NOT TypeScript) that orchestrates subagents at scale:",
    "the model writes the script, this tool runs it.",
    "",
    "WHEN TO USE: reach for a workflow when the task decomposes into dozens-to-hundreds of agents",
    "(more than one conversation can coordinate), or when you want the orchestration codified as a",
    "rerunnable, resumable script. Do NOT use it for single quick file reads/edits or when ordinary",
    "tools suffice.",
    "",
    "THE SCRIPT CONTRACT:",
    "- Plain JS only. No import/require/fs/process/Node APIs.",
    "- MUST start with `export const meta = { name, description, ... }` (a pure literal — no",
    "  variables, spreads, or interpolation).",
    "- These globals are injected into scope: agent(prompt, {executor, ...}), parallel(thunks),",
    "  pipeline(items, ...stages), phase(title), log(message), args, workflow(ref, args?).",
    "- Named workers: {executor:'zcode'}, {executor:'grok'}, {executor:'claude'}, {executor:'codex'}.",
    "  When executor is omitted, the host CLI is used: grok on Grok Build, zcode on ZCode,",
    "  codex on Codex, claude on Claude Code. Name another worker to override. An unknown",
    "  name fails the run.",
    "- Codex model overrides default reasoningEffort to 'medium'; set reasoningEffort explicitly",
    "  only when the selected model supports the requested value.",
    "- agent(prompt, {schema}) returns a validated object (schema root must be type:'object').",
    "- pipeline() has NO barrier between stages (default for multi-stage); parallel() IS a barrier.",
    "- Determinism: Date.now/Math.random/argless new Date() throw (resume safety). Pass timestamps",
    "  via args; vary by index.",
    "- Limits: up to min(16, cpus-2) concurrent agents, 1000 total per run.",
    "- A top-level `return <value>` is the workflow's result (JSON-serializable).",
    "",
    "PARAMETERS:",
    "- cwd: absolute project directory for workflow artifacts and subagents. Codex callers MUST",
    "  pass the active workspace path because the plugin server itself runs from its install dir.",
    "- script: the inline JS source (preferred). Pass the script inline — do NOT write it to a",
    "  file first.",
    "- scriptPath: path to a saved script file (alternative to script; use for re-runs).",
    "- args: any JSON value passed into the script as the `args` global.",
    "- resumeFromRunId: re-run a previous run; completed agent() calls replay from the journal with",
    "  ZERO token spend, the rest run live.",
    "",
    "RESULT: the tool returns whatever the script `return`ed (its `value`), plus run metadata.",
    "isError is true when !ok; swallowed leaf failures keep ok=true but appear in failedAgents",
    "with a resume hint.",
    "",
    "Artifacts (script snapshot, journal, per-agent traces) land under .odw/<name>/runs/<runId>/.",
    "Consult the $open-dynamic-workflows skill for full authoring guidance and worked patterns.",
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      cwd: {
        type: "string",
        minLength: 1,
        description:
          "Absolute project directory used for workflow artifacts and subagents. Required from Codex callers. Grok and ZCode may omit it (host project dir is used).",
      },
      script: {
        type: "string",
        description:
          "The inline workflow script source (plain JS, starts with `export const meta = {...}`). Preferred over scriptPath.",
      },
      scriptPath: {
        type: "string",
        description: "Path to a saved workflow script file. Alternative to script.",
      },
      args: {
        description:
          "Any JSON value passed into the script as the `args` global. Verbatim.",
      },
      resumeFromRunId: {
        type: "string",
        description:
          "Re-run a previous run by id. Completed agent() calls replay from the journal with zero token spend.",
      },
    },
  },
};

const TOOLS = NESTED_GROK_LEAF ? [] : [WORKFLOW_TOOL];
const activeCalls = new Map<number | string, AbortController>();
let responseFraming: "content-length" | "line" = "content-length";

// ────────────────────────────────────────────────────────────────────────────
// MCP JSON-RPC over stdio (Content-Length framing + bare-line fallback).
// MCP JSON-RPC over stdio（Content-Length 分帧 + 裸行回退）。
// Reused near-verbatim from the zcode example-plugin hello-server.mjs.
// 近乎原样复用自 zcode example-plugin 的 hello-server.mjs。
// ────────────────────────────────────────────────────────────────────────────

function writeMessage(message: unknown): void {
  const body = JSON.stringify(message);
  if (responseFraming === "line") {
    process.stdout.write(`${body}\n`);
    return;
  }
  // MCP stdio framing: Content-Length header + body.
  // MCP stdio 分帧：Content-Length 头 + body。
  const payload = `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`;
  process.stdout.write(payload);
}

function ok(id: number | string | null, result: unknown): void {
  writeMessage({ jsonrpc: "2.0", id, result });
}

function fail(id: number | string | null, code: number, message: string): void {
  writeMessage({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

// Run a workflow from tool call arguments. Resolves to an MCP tool-call result
// ({content, isError}). Never throws — failures land in isError + text so the model
// can react. Progress is streamed to stderr (server diagnostics) since v1 is synchronous
// and returns only at completion.
// 从工具调用参数运行一个 workflow。resolve 为 MCP 工具调用结果（{content, isError}）。
// 绝不抛错——失败落到 isError + text，让模型可据此反应。进度流到 stderr（server 诊断），
// 因为 v1 是同步的，只在完成时返回。
async function runWorkflowTool(
  args: {
    cwd?: unknown;
    script?: unknown;
    scriptPath?: unknown;
    args?: unknown;
    resumeFromRunId?: unknown;
  },
  signal?: AbortSignal,
  sandboxCwd?: unknown,
): Promise<{ content: Array<{ type: "text"; text: string }>; isError: boolean }> {
  const { cwd: requestedCwd, script, scriptPath, args: workflowArgs, resumeFromRunId } = args;

  if (!script && !scriptPath) {
    return {
      content: [
        {
          type: "text",
          text: "workflow tool requires either `script` (inline source) or `scriptPath` (path to a file).",
        },
      ],
      isError: true,
    };
  }

  if (NESTED_GROK_LEAF) {
    return {
      content: [
        {
          type: "text",
          text: "Nested grok leaves cannot start another workflow (ODW_GROK_LEAF=1).",
        },
      ],
      isError: true,
    };
  }

  if (process.env.ODW_REQUIRE_CWD === "1" && requestedCwd === undefined) {
    return {
      content: [{ type: "text", text: "Codex workflow calls require an absolute `cwd`." }],
      isError: true,
    };
  }

  if (
    requestedCwd !== undefined &&
    (typeof requestedCwd !== "string" || !requestedCwd || !isAbsolute(requestedCwd))
  ) {
    return {
      content: [{ type: "text", text: "workflow `cwd` must be an absolute project path." }],
      isError: true,
    };
  }

  if (
    (script !== undefined && typeof script !== "string") ||
    (scriptPath !== undefined && typeof scriptPath !== "string") ||
    (resumeFromRunId !== undefined && typeof resumeFromRunId !== "string")
  ) {
    return {
      content: [
        {
          type: "text",
          text: "workflow script, scriptPath, and resumeFromRunId must be strings.",
        },
      ],
      isError: true,
    };
  }

  if (process.env.ODW_REQUIRE_CWD === "1") {
    if (typeof sandboxCwd !== "string") {
      return {
        content: [{ type: "text", text: "Codex did not provide trusted workspace metadata." }],
        isError: true,
      };
    }
    try {
      const [requested, trusted] = await Promise.all([
        realpath(requestedCwd as string),
        realpath(fileURLToPath(sandboxCwd)),
      ]);
      if (requested !== trusted) {
        return {
          content: [{ type: "text", text: "workflow `cwd` must match the active Codex workspace." }],
          isError: true,
        };
      }
    } catch {
      return {
        content: [{ type: "text", text: "workflow `cwd` or Codex workspace path is invalid." }],
        isError: true,
      };
    }
  }

  // Grok plugin MCP inherits the session project as process.cwd() — mcp.json must
  // not pin cwd to GROK_PLUGIN_ROOT (that writes .odw into the install dir).
  // GROK_WORKSPACE_ROOT is hook-only and is not set on the MCP process.
  const cwd =
    requestedCwd ||
    process.env.ZCODE_PROJECT_DIR ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.cwd();

  let result: WorkflowResult;
  try {
    result = await runWorkflow({
      ...(script !== undefined ? { script } : {}),
      ...(scriptPath !== undefined ? { scriptPath } : {}),
      ...(workflowArgs !== undefined ? { args: workflowArgs } : {}),
      ...(resumeFromRunId !== undefined ? { resumeFromRunId } : {}),
      cwd,
      executors: EXECUTORS,
      ...(DEFAULT_EXECUTOR !== undefined ? { defaultExecutor: DEFAULT_EXECUTOR } : {}),
      ...(signal !== undefined ? { signal } : {}),
      onEvent: (event) => {
        // Stream one-line progress to stderr so a long run isn't opaque. The MCP protocol
        // carries the final result on stdout; stderr is server diagnostics.
        // 把单行进度流到 stderr，避免长 run 变得不可见。MCP 协议在 stdout 承载最终结果；
        // stderr 是 server 诊断。
        process.stderr.write(`[odw] ${event.type}\n`);
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: [{ type: "text", text: `workflow run threw: ${message}` }],
      isError: true,
    };
  }

  // Surface the script's return value + actionable run metadata. When any leaf failed, include
  // the count and a resume hint even if the script intentionally absorbed that failure.
  // 呈现脚本的返回值 + 可操作的 run 元数据。任何叶节点失败时都带上数量和 resume 提示，
  // 即便脚本有意吸收了该失败。
  const summary = {
    value: result.value ?? null,
    runId: result.runId,
    ok: result.ok,
    agentCount: result.agentCount,
    failedAgents: result.failedAgents,
    tokensSpent: result.tokensSpent,
    durationMs: result.durationMs,
    ...(result.failedAgents > 0
      ? { hint: `${result.failedAgents} agent(s) failed. Resume with resumeFromRunId: "${result.runId}".` }
      : {}),
  };

  return {
    content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    isError: !result.ok,
  };
}

function handleRequest(msg: unknown): void {
  if (typeof msg !== "object" || msg === null || Array.isArray(msg)) {
    fail(null, -32600, "Invalid Request");
    return;
  }

  const request = msg as {
    id?: number | string | null;
    method?: unknown;
    params?: unknown;
  };
  const { id, method, params } = request;
  if (
    id !== undefined &&
    id !== null &&
    typeof id !== "number" &&
    typeof id !== "string"
  ) {
    fail(null, -32600, "Invalid Request");
    return;
  }
  if (typeof method !== "string") {
    fail(id ?? null, -32600, "Invalid Request");
    return;
  }
  // Notifications (no id) — ignore after initialize.
  // 通知（无 id）—— initialize 之后忽略。
  if (id === undefined || id === null) {
    if (method === "notifications/initialized" || method === "initialized") return;
    if (method === "notifications/cancelled") {
      const requestId =
        typeof params === "object" && params !== null && "requestId" in params
          ? (params as { requestId?: unknown }).requestId
          : undefined;
      if (typeof requestId === "number" || typeof requestId === "string") {
        activeCalls.get(requestId)?.abort();
      }
      return;
    }
    process.stderr.write(`[odw] ignore notification ${method}\n`);
    return;
  }

  switch (method) {
    case "initialize":
      ok(id, {
        protocolVersion:
          typeof params === "object" && params !== null && "protocolVersion" in params
            ? (params as { protocolVersion?: string }).protocolVersion || "2024-11-05"
            : "2024-11-05",
        capabilities: { tools: {}, experimental: { [SANDBOX_META_KEY]: {} } },
        serverInfo: SERVER_INFO,
      });
      return;
    case "ping":
      ok(id, {});
      return;
    case "tools/list":
      ok(id, { tools: TOOLS });
      return;
    case "tools/call": {
      if (typeof params !== "object" || params === null || Array.isArray(params)) {
        fail(id, -32602, "Invalid params");
        return;
      }
      const toolParams = params as {
        name?: unknown;
        arguments?: unknown;
        _meta?: Record<string, unknown>;
      };
      const name = toolParams.name;
      const callArgs = toolParams.arguments ?? {};
      if (name !== "workflow") {
        fail(id, -32601, `Unknown tool: ${name}`);
        return;
      }
      if (typeof callArgs !== "object" || callArgs === null || Array.isArray(callArgs)) {
        fail(id, -32602, "Invalid workflow arguments");
        return;
      }
      // Async handler — tools/call runs a full workflow (potentially minutes).
      // 异步处理——tools/call 运行一整个 workflow（可能数分钟）。
      const controller = new AbortController();
      activeCalls.set(id, controller);
      const sandboxState = toolParams._meta?.[SANDBOX_META_KEY];
      const sandboxCwd =
        typeof sandboxState === "object" && sandboxState !== null && "sandboxCwd" in sandboxState
          ? (sandboxState as { sandboxCwd?: unknown }).sandboxCwd
          : undefined;
      void runWorkflowTool(callArgs, controller.signal, sandboxCwd)
        .then((toolResult) => ok(id, toolResult))
        .catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          ok(id, {
            content: [{ type: "text", text: `workflow request failed: ${message}` }],
            isError: true,
          });
        })
        .finally(() => activeCalls.delete(id));
      return;
    }
    default:
      fail(id, -32601, `Method not found: ${method}`);
  }
}

function handleRaw(raw: string): void {
  const trimmed = raw.trim();
  if (!trimmed) return;
  let msg: any;
  try {
    msg = JSON.parse(trimmed);
  } catch (err) {
    process.stderr.write(`[odw] bad JSON: ${err}\n`);
    fail(null, -32700, "Parse error");
    return;
  }
  if (Array.isArray(msg)) {
    if (msg.length === 0) {
      fail(null, -32600, "Invalid Request");
      return;
    }
    for (const item of msg) handleRequest(item);
    return;
  }
  handleRequest(msg);
}

// Support both Content-Length framed streams and newline-delimited JSON.
// 同时支持 Content-Length 分帧流和换行分隔的 JSON。
let buffer = Buffer.alloc(0);

process.stdin.on("data", (chunk: Buffer) => {
  buffer = Buffer.concat([buffer, chunk]);
  while (true) {
    const headerEnd = buffer.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      // Fallback: if buffer looks like a complete JSON line without framing, parse lines.
      // 回退：若 buffer 看起来像无分帧的完整 JSON 行，按行解析。
      const asText = buffer.toString("utf8");
      if (asText.includes("\n") && asText.trimStart().startsWith("{")) {
        responseFraming = "line";
        const lines = asText.split(/\r?\n/);
        buffer = Buffer.from(lines.pop() || "", "utf8");
        for (const line of lines) handleRaw(line);
      }
      break;
    }
    const header = buffer.slice(0, headerEnd).toString("utf8");
    const match = /Content-Length:\s*(\d+)/i.exec(header);
    if (!match) {
      buffer = buffer.slice(headerEnd + 4);
      continue;
    }
    const length = Number(match[1]);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;
    if (buffer.length < bodyEnd) break;
    const body = buffer.slice(bodyStart, bodyEnd).toString("utf8");
    buffer = buffer.slice(bodyEnd);
    responseFraming = "content-length";
    handleRaw(body);
  }
});

process.stdin.on("end", () => {
  for (const controller of activeCalls.values()) controller.abort();
  if (buffer.length) handleRaw(buffer.toString("utf8"));
});

process.stderr.write(
  `[odw] open-dynamic-workflows MCP server ready (executors: zcode,grok,claude,codex${DEFAULT_EXECUTOR ? `; default=${DEFAULT_EXECUTOR}` : ""})\n`,
);
