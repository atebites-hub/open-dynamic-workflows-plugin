// grok.ts — the only module that touches the `grok` CLI.
//
// Spawns a headless Grok Build leaf (the subprocess form of `grok -p`):
//   grok --prompt-file <tmp> --output-format streaming-json --permission-mode acceptEdits …
//
// `--prompt-file` is the argv-safe equivalent of `-p` (long workflow prompts).
// `--output-format json` pretty-prints and cannot be parsed line-by-line, so
// streaming-json is required. Shared spawn / kill / watchdog / trace lives in
// ODW's makeSubprocessExecutor.

import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import {
  makeSubprocessExecutor,
  type ExecOptions,
  type Executor,
} from "../../open-dynamic-workflows/dist/index.js";
import { parseGrokStreamLine, reduceGrokStreamEvents } from "./grok-json.ts";

/** Managed Grok Build install on this studio image. Also check `$HOME/.grok/bin`. */
export const GROK_BUILD_BIN_DIR = "/home/box/.grok/bin";

const GROK_BIN = process.env.GROK_BIN?.trim() || "grok";

const PERMISSION_MODES = new Set([
  "default",
  "acceptEdits",
  "auto",
  "dontAsk",
  "bypassPermissions",
  "plan",
]);

/**
 * Permission mode for headless leaves. Default `acceptEdits` matches the Claude
 * executor (workspace writes, not a full bypass). Palemon Director seats that
 * already run `--permission-mode bypassPermissions` can set
 * `GROK_ODW_PERMISSION_MODE=bypassPermissions` and optionally
 * `GROK_ODW_ALWAYS_APPROVE=1`.
 */
export function grokPermissionMode(): string {
  const raw = process.env.GROK_ODW_PERMISSION_MODE?.trim();
  if (raw && PERMISSION_MODES.has(raw)) return raw;
  return "acceptEdits";
}

/** Prepend Grok Build bin dirs so a bare `grok` resolves without a login shell. */
export function grokChildPath(): string {
  const prefix: string[] = [];
  const homeBin = join(homedir(), ".grok", "bin");
  for (const dir of [GROK_BUILD_BIN_DIR, homeBin]) {
    if (existsSync(dir) && !prefix.includes(dir)) prefix.push(dir);
  }
  const pinned = process.env.GROK_BIN?.trim();
  if (pinned && pinned.includes("/")) {
    const dir = dirname(pinned);
    if (dir && !prefix.includes(dir)) prefix.unshift(dir);
  }
  const rest = process.env.PATH ?? "";
  return prefix.length > 0 ? `${prefix.join(delimiter)}${delimiter}${rest}` : rest;
}

export function grokChildEnv(): Record<string, string> {
  return {
    PATH: grokChildPath(),
    GROK_DISABLE_AUTOUPDATER: "1",
  };
}

/**
 * Argv for a Grok Build leaf. Fixed base is headless, non-interactive, and
 * isolated from the parent Director's subagent/plan/memory loops.
 */
export function buildGrokArgs(opts: ExecOptions, promptPath: string): string[] {
  const args: string[] = [
    "--prompt-file",
    promptPath,
    "--output-format",
    "streaming-json",
    "--permission-mode",
    grokPermissionMode(),
    "--cwd",
    opts.cwd,
    "--no-subagents",
    "--no-plan",
    "--no-memory",
    "--verbatim",
    "--no-auto-update",
  ];
  if (process.env.GROK_ODW_ALWAYS_APPROVE === "1") {
    args.push("--always-approve");
  }
  if (opts.model) args.push("-m", opts.model);
  if (opts.reasoningEffort) args.push("--reasoning-effort", opts.reasoningEffort);
  if (opts.appendSystemPrompt) args.push("--rules", opts.appendSystemPrompt);
  if (opts.schema) args.push("--json-schema", JSON.stringify(opts.schema));
  if (opts.resumeSessionId) args.push("--resume", opts.resumeSessionId);
  return args;
}

function reduceGrok(
  events: unknown[],
  ctx: { stderr: string; exitCode: number | null; opts: ExecOptions },
) {
  const outcome = reduceGrokStreamEvents(events, {
    schema: ctx.opts.schema !== undefined,
    exitCode: ctx.exitCode,
  });

  const core = {
    text: outcome.text,
    sessionId: outcome.sessionId,
    costUsd: outcome.costUsd,
    resultSubtype: outcome.resultSubtype,
    isError: outcome.isError,
    usage: {
      inputTokens: outcome.usage.inputTokens,
      outputTokens: outcome.usage.outputTokens,
    },
    ...(outcome.telemetryAvailable ? { telemetryAvailable: true } : {}),
    ...(outcome.structuredOutput !== undefined
      ? { structuredOutput: outcome.structuredOutput }
      : {}),
  };
  if (core.isError && ctx.stderr.trim().length > 0 && core.text.length === 0) {
    core.text = ctx.stderr.trim();
  }
  return core;
}

export const grokExecutor: Executor = makeSubprocessExecutor({
  command: GROK_BIN,
  prepare: async (opts) => {
    const promptPath = join(
      tmpdir(),
      `odw-grok-prompt-${randomBytes(8).toString("hex")}.txt`,
    );
    await writeFile(promptPath, opts.prompt, { mode: 0o600 });
    return {
      args: buildGrokArgs(opts, promptPath),
      env: grokChildEnv(),
      cleanup: () => unlink(promptPath).catch(() => {}),
    };
  },
  parseLine: parseGrokStreamLine,
  reduce: (events, ctx) => reduceGrok(events, ctx),
});
