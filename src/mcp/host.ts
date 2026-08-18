// Host detection for the plugin MCP server.
// Grok is the default worker only when this process is hosted by Grok Build.
// Codex sets ODW_REQUIRE_CWD=1 and keeps the fail-fast "executor required" rule.

export function isGrokHost(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ODW_REQUIRE_CWD === "1") return false;
  if (env.ODW_HOST === "grok") return true;
  return Boolean(env.GROK_PLUGIN_ROOT?.trim());
}
