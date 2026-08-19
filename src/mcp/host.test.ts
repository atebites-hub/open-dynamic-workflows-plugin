import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultExecutorForHost, isGrokHost } from "./host.ts";

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
  assert.equal(isGrokHost({ GROK_PLUGIN_ROOT: "/g" }), true);
  assert.equal(isGrokHost({ ZCODE_PLUGIN_ROOT: "/z" }), false);
});
