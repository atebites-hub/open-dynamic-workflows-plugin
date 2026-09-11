// Host detection for the plugin MCP server.
// Host identity and the default worker are separate. Explicit ODW_HOST
// wins; otherwise infer from plugin-root / Codex cwd-requirement env.
// Grok also sets CLAUDE_PLUGIN_ROOT as an alias, so GROK_PLUGIN_ROOT is checked first.

export type HostExecutor = "cursor" | "grok" | "zcode" | "codex" | "claude" | "antigravity" | "copilot";
export type Host = HostExecutor | "grok-bot";

const NAMED_HOSTS = new Set<string>(["cursor", "grok", "grok-bot", "zcode", "codex", "claude", "antigravity", "copilot"]);

export function detectHost(
  env: NodeJS.ProcessEnv = process.env,
): Host | undefined {
  const named = env.ODW_HOST?.trim();
  if (named) return NAMED_HOSTS.has(named) ? named as Host : undefined;
  if (env.ODW_REQUIRE_CWD === "1") return "codex";
  if (env.GROK_PLUGIN_ROOT?.trim()) return "grok";
  if (env.CURSOR_PLUGIN_ROOT?.trim() || env.PLUGIN_ROOT?.trim()) return "cursor";
  if (env.ZCODE_PLUGIN_ROOT?.trim()) return "zcode";
  if (env.CLAUDE_PLUGIN_ROOT?.trim()) return "claude";
  return undefined;
}

export function defaultExecutorForHost(env: NodeJS.ProcessEnv = process.env): HostExecutor | undefined {
  const host = detectHost(env);
  return host === "grok-bot" ? "cursor" : host;
}

export function nativeOrchestrationAdvice(host: Host | undefined): string | undefined {
  if (host === "claude") return "Claude harnesses use native ultracode. Enable ultracode in the host; ODW is not activated here. Keep the user's chosen model.";
  if (host === "codex") return "Codex/ChatGPT harnesses use native ultra mode. Select ultra effort in the host; ODW is not activated here. Keep the user's chosen model.";
  return undefined;
}

export function isGrokHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return detectHost(env) === "grok";
}
