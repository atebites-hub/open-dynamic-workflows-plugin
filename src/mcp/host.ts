// Host detection for the plugin MCP server.
// Each host defaults omitted agent() calls to its own CLI. Explicit ODW_HOST
// wins; otherwise infer from plugin-root / Codex cwd-requirement env.
// Grok also sets CLAUDE_PLUGIN_ROOT as an alias, so GROK_PLUGIN_ROOT is checked first.

export type HostExecutor = "cursor" | "grok" | "zcode" | "codex" | "claude" | "antigravity" | "copilot";

const NAMED_HOSTS = new Set<string>(["cursor", "grok", "zcode", "codex", "claude", "antigravity", "copilot"]);

export function defaultExecutorForHost(
  env: NodeJS.ProcessEnv = process.env,
): HostExecutor | undefined {
  const named = env.ODW_HOST?.trim();
  if (named) return NAMED_HOSTS.has(named) ? named as HostExecutor : undefined;
  if (env.ODW_REQUIRE_CWD === "1") return "codex";
  if (env.GROK_PLUGIN_ROOT?.trim()) return "grok";
  if (env.CURSOR_PLUGIN_ROOT?.trim() || env.PLUGIN_ROOT?.trim()) return "cursor";
  if (env.ZCODE_PLUGIN_ROOT?.trim()) return "zcode";
  if (env.CLAUDE_PLUGIN_ROOT?.trim()) return "claude";
  return undefined;
}

export function nativeOrchestrationAdvice(host: HostExecutor | undefined): string | undefined {
  if (host === "claude") return "Claude harnesses use native ultracode. Enable ultracode in the host; ODW is not activated here. Keep the user's chosen model.";
  if (host === "codex") return "Codex/ChatGPT harnesses use native ultra mode. Select ultra effort in the host; ODW is not activated here. Keep the user's chosen model.";
  return undefined;
}

export function isGrokHost(env: NodeJS.ProcessEnv = process.env): boolean {
  return defaultExecutorForHost(env) === "grok";
}
