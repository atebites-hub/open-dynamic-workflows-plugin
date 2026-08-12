// grok-json.ts — pure reducer over `grok --output-format streaming-json`.
//
// Grok's `--output-format json` pretty-prints one object (not line-delimited), so the
// shared ODW subprocess driver cannot parse it. `streaming-json` is NDJSON and is the
// right machine format for a leaf. No I/O; parse + fold only.

import { extractJsonObject } from "../../open-dynamic-workflows/dist/schema/extract-json.js";

export interface GrokStreamOutcome {
  text: string;
  structuredOutput?: unknown;
  sessionId: string | null;
  costUsd: number;
  resultSubtype: string;
  isError: boolean;
  usage: { inputTokens: number; outputTokens: number };
  telemetryAvailable: boolean;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function toFiniteNumber(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** JSON.parse one NDJSON line; skip blanks and non-objects. Never throws. */
export function parseGrokStreamLine(line: string): unknown | null {
  const trimmed = line.trim();
  if (trimmed.length === 0) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fold grok streaming-json events into one outcome.
 *
 * Text is the concatenation of `type:"text"` chunks. Settlement comes from the
 * terminal `type:"end"` event (usage, sessionId, cost, stopReason). `type:"error"`
 * marks the turn failed. Missing `end` is an execution error (the CLI died first).
 */
export function reduceGrokStreamEvents(
  events: unknown[],
  opts?: { schema?: boolean; exitCode?: number | null },
): GrokStreamOutcome {
  let text = "";
  let sessionId: string | null = null;
  let sawEnd = false;
  let sawError = false;
  let errorText = "";
  let stopReason = "";
  let costUsd = 0;
  let telemetryAvailable = false;
  const usage = { inputTokens: 0, outputTokens: 0 };

  for (const event of events) {
    if (!isObject(event)) continue;
    const type = event["type"];

    if (type === "text" && typeof event["data"] === "string") {
      text += event["data"];
      continue;
    }

    if (type === "error") {
      sawError = true;
      if (typeof event["message"] === "string" && event["message"].trim().length > 0) {
        errorText = event["message"].trim();
      }
      continue;
    }

    if (type === "end") {
      sawEnd = true;
      if (typeof event["sessionId"] === "string") sessionId = event["sessionId"];
      if (typeof event["stopReason"] === "string") stopReason = event["stopReason"];
      if (typeof event["total_cost_usd"] === "number" && Number.isFinite(event["total_cost_usd"])) {
        costUsd = event["total_cost_usd"];
        telemetryAvailable = true;
      }
      const rawUsage = event["usage"];
      if (isObject(rawUsage)) {
        usage.inputTokens = toFiniteNumber(rawUsage["input_tokens"]);
        usage.outputTokens = toFiniteNumber(rawUsage["output_tokens"]);
        telemetryAvailable = true;
      }
    }
  }

  const exitFailed = opts?.exitCode !== undefined && opts.exitCode !== null && opts.exitCode !== 0;
  const isError = sawError || !sawEnd || exitFailed;
  const outcome: GrokStreamOutcome = {
    text: isError && text.length === 0 && errorText.length > 0 ? errorText : text,
    sessionId,
    costUsd,
    resultSubtype: isError
      ? stopReason === "max_turn_requests" || stopReason === "max_tokens"
        ? "error_max_turns"
        : "error_during_execution"
      : "success",
    isError,
    usage,
    telemetryAvailable,
  };

  if (opts?.schema) {
    const candidate = extractJsonObject(outcome.text) ?? outcome.text;
    try {
      outcome.structuredOutput = JSON.parse(candidate);
    } catch {
      outcome.isError = true;
      outcome.resultSubtype = "error_during_execution";
    }
  }

  return outcome;
}
