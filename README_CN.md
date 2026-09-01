# open-dynamic-workflows（Cursor + Grok Build + Claude Code + Codex + ZCode 插件）

[English](./README.md)

面向 **Cursor、Grok Build、Claude Code、Codex 和 ZCode** 的动态工作流编排——通过原生 `workflow` 工具和编写 skill，
把一段确定性 JavaScript 脚本扇出成大量 CLI 子 agent。

## 安装（Cursor CLI）

Cursor CLI（`agent`，来自 [cursor.com/install](https://cursor.com/install)）目前还不能像 Grok/Codex 那样从 marketplace 非交互安装插件。用仓库里的安装脚本——复制一次，然后**新开** `agent` 会话即可使用 `workflow` 工具和编写 skill。未指名 `executor` 时使用 `cursor`。

```bash
git clone --depth 1 https://github.com/atebites-hub/open-dynamic-workflows-plugin.git
node open-dynamic-workflows-plugin/scripts/install-cursor-cli.mjs
```

脚本会把**绝对路径**的 MCP 命令写入 `~/.cursor/mcp.json`（CLI 的用户/项目 `mcp.json` 不会展开 `${PLUGIN_ROOT}`），把插件链到 `~/.cursor/plugins/local/open-dynamic-workflows`，并把 skill 拷到 `~/.cursor/skills/open-dynamic-workflows`。然后：

```bash
agent mcp enable open-dynamic-workflows
agent mcp list
```

无界面检查：`agent -p --force --trust --workspace . --output-format json --approve-mcps`。开发时可跳过 home 安装，用双格式插件（Cursor Plugin + Agent Plugin）：`agent --plugin-dir /path/to/open-dynamic-workflows-plugin`。

### Cursor IDE

`cursor-agent plugin marketplace add atebites-hub/open-dynamic-workflows-plugin` 只登记 marketplace。请在 **Customize** 里安装 **open-dynamic-workflows**，或拷/链到 `~/.cursor/plugins/local`。插件 `mcp.json` 仍使用 `${PLUGIN_ROOT}`。

未指名 `executor` 时跑在 `cursor` 上（`agent` / `cursor-agent` / `CURSOR_BIN`）。嵌套 Cursor 叶子会设置 `ODW_CURSOR_LEAF=1`，不得再加载本插件的 `workflow` 工具。

## Cursor 团队 marketplace

本仓库就是团队 marketplace 目录（`.cursor-plugin/marketplace.json`，名称 `atebites-cursor-plugins`）。在 **Dashboard → Plugins → Import from Repo** 导入：

```text
https://github.com/atebites-hub/open-dynamic-workflows-plugin
```

然后在 **Customize** 里安装：

- **open-dynamic-workflows** — 本仓库（`plugins/open-dynamic-workflows`）
- **ponytail** — https://github.com/DietrichGebert/ponytail
- **sol-advisor** — https://github.com/atebites-hub/sol-advisor

远程 `source` 使用 GitHub URL（官方 schema 允许）。插件条目只有 `name`、`source`、`description`。若 Import from Repo 只索引仓库内路径，把 ponytail 和 sol-advisor 的 GitHub 仓库再加为 marketplace——这里不内嵌它们的源码。

**open-dynamic-workflows** 的 CLI 安装仍是上面的 `node scripts/install-cursor-cli.mjs`。

一段动态工作流就是**编排大量子 agent 的纯 JS 脚本**。模型为任务编写脚本；插件内置的
运行时执行它，把每个 `agent()` 调用扇出成一个真实的 `grok`、`claude`、`codex` 或 `zcode`
子进程。控制流（循环、分支、扇出）在确定性 JS 里——LLM 的活只发生在叶子节点。

## 安装（Grok Build）

```bash
grok plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
grok plugin install open-dynamic-workflows --trust
```

新开一个 Grok 会话（或在 Plugins 标签按 `r`）。未指名 executor 的 `agent()` 跑在 `grok` 上。
插件是自包含的，无需在项目中检出或构建 ODW。

## 安装（Codex）

```bash
codex plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
codex plugin add open-dynamic-workflows@open-dynamic-workflows
```

新开一个 Codex 会话。插件是自包含的，无需在项目中检出或构建 ODW。Codex 调用
`workflow` 时必须通过 `cwd` 传入当前工作区的绝对路径。

## 安装（ZCode 用户）

```
/plugins marketplace add atebites-hub/open-dynamic-workflows-plugin
/plugins install open-dynamic-workflows
```

然后重启 ZCode（或新开一个会话）。就这些——无需构建步骤，无需 `node_modules`。插件交付
了一个自包含的 `dist/mcp/server.js`。

## 安装（Claude Code）

将本仓库作为 Claude Code 插件安装（或校验仓库中的 `.claude-plugin/plugin.json` 镜像），然后启用
`open-dynamic-workflows` MCP server。省略 `executor` 时使用 `claude`，省略 `cwd` 时继承 Claude 项目目录。

安装后，一个会话会获得：
- 一个 **`workflow` 工具**——模型编写脚本并调用 `workflow({ cwd, script })`；它运行到
  完成，返回脚本的返回值。
- 一份 **`$open-dynamic-workflows` skill**——编写指南（何时用工作流、`meta`/`agent()`/
  `pipeline()`/`parallel()` 契约、成熟的形态）。
- 一个 **`/open-dynamic-workflows:workflows`** 斜杠命令——列出并恢复当前项目里的 run。

## 工作原理

```
模型编写一段 JS 工作流脚本
  └─ 调用 workflow({ cwd, script })
      └─ 插件的 MCP server（dist/mcp/server.js）
          └─ ODW 运行时：runWorkflow({ executors: { zcode, grok, claude, codex } })
              ├─ agent({executor:'zcode'})（ZCode 托管时可省略）spawn `zcode --prompt …`
              ├─ agent({executor:'grok'})（Grok Build 托管时可省略）spawn `grok -p …`
              ├─ agent({executor:'claude'}) spawn `claude --print …`
              ├─ agent({executor:'codex'}) spawn `codex exec --json …`
              ├─ parallel()/pipeline() 负责编排，journal 持久化结果
              └─ 返回脚本的 `return` 值 + run 元数据
```

两个执行器都使用用户 `PATH` 中已安装的 CLI。Codex 会先用 host 提供的工作区元数据校验
`cwd`，再在 `workspace-write` 沙箱中运行；其原生 shell 策略会从模型执行的命令中移除
key/secret/token 环境变量。ZCode 使用 `ZCODE_ODW_PROTOCOL=1`。每个 agent 是一个真实的模型
turn。Codex 覆盖模型时，推理强度默认设为 `medium`，避免继承不兼容的用户配置。Run 可恢复：
已完成的 agent 从 journal 零 token 重放。

## 一段最小工作流

```js
export const meta = { name: 'demo', description: '两个并行的 zcode agent' }

const results = await parallel([
  () => agent('2+2 等于几？只回复数字。', { executor: 'zcode', label: 'math' }),
  () => agent('说一颗红色的行星。一个词。', { executor: 'zcode', label: 'trivia' }),
])
return { results }
```

调用 `workflow({ cwd: "/项目的绝对路径", script: "<上面这段>" })`，工具返回 `{ value: { results: [...] }, runId, ok, ... }`。

完整的编写契约（phase、schema、pipeline 与 parallel 的取舍、对抗式校验 / 评审团 /
直到搜干等形态）见 `$open-dynamic-workflows` skill。

## 仓库结构

本仓库**既是 marketplace 也是插件**（Grok 的 `.grok-plugin/marketplace.json` 与 ZCode 的
`marketplace.json` 都用本地 `./` 源）。

```
├── .cursor-plugin/marketplace.json # Cursor 团队 marketplace 目录（官方 schema）
├── .cursor-plugin/plugin.json      # Cursor 插件清单
├── plugin.json                     # Agent Plugins 清单（CLI --plugin-dir）
├── mcp.json                        # Cursor MCP 启动（${PLUGIN_ROOT}）
├── scripts/install-cursor-cli.mjs  # Cursor CLI 安装（绝对 MCP 路径）
├── .grok-plugin/marketplace.json   # Grok marketplace 目录
├── .grok-plugin/plugin.json        # Grok 插件清单
├── .grok-plugin/mcp.json           # Grok MCP 启动配置（GROK_PLUGIN_ROOT）
├── plugins/open-dynamic-workflows/ # Grok marketplace 安装包（Grok 拒绝 source "./"）
├── marketplace.json                # ZCode marketplace 清单
├── .zcode-plugin/plugin.json       # ZCode 插件清单
├── .claude-plugin/plugin.json      # Claude Code 兼容镜像
├── .mcp.json                       # ZCode stdio MCP（${ZCODE_PLUGIN_ROOT}）
├── skills/open-dynamic-workflows/  # 编写 skill（从 ODW 引入）
├── commands/workflows.md           # /workflows 斜杠命令
├── src/mcp/server.ts               # MCP server 源码（`workflow` 工具）
├── dist/mcp/server.js              # 已提交的自包含打包产物（实际运行的）
├── scripts/{build,setup,smoke}.mjs # 开发构建 + 冒烟流水线
├── open-dynamic-workflows/         # git submodule（ODW 源码——仅开发用）
└── zcode-cli/                      # git submodule（开发便利；不打包）
```

### 面向维护者 / 贡献者

用户运行的 `dist/mcp/server.js` 由 submodule 构建并提交。clone 之后：

```bash
npm run setup    # 初始化 submodule + 锁定安装 + 构建 ODW + esbuild → dist/mcp/server.js
npm run smoke    # 构建产物的独立 JSON-RPC 冒烟测试
npm run build    # 只重新打包（跳过 submodule 初始化）
npm run verify   # 重新打包并运行插件冒烟检查
node scripts/install-cursor-cli.mjs   # Cursor CLI：MCP + 本地插件 + skill
```

构建（`scripts/build.mjs`）用 esbuild 把 ODW 及其唯一依赖（`ajv`）内联进单个 ESM 文件，
与 android-emulator 插件的模式一致。交付给用户的产物不含 `node_modules`。

## 受治理的路由（v0.3）

需要一次运行固定使用同一路由时，传入不可变 policy：

```js
workflow({
  cwd: "/项目的绝对路径",
  routingPolicy: { executor: "codex", model: "gpt-5.4", reasoningEffort: "high" },
  script,
})
```

policy 由 ODW core 在创建 journal 或启动子进程前验证。省略的节点路由继承 policy；显式的
executor、model 或 reasoning effort 不一致会在启动前失败。嵌套工作流继承同一 policy。policy
运行不能与 `resumeFromRunId` 或缓存重放组合。MCP 结果只公开允许的 policy 三元组及其 SHA-256
`routingPolicyFingerprint`；这只是关联证据，不证明 host CLI 真正接受了 model。host 提供时，
请在 run trace 中查看权威的 executor/model/effort 和 runtime ID。

不传 policy 时，现有 host 默认保持不变：从启动环境选择 Cursor、Grok、Claude、Codex 或 ZCode。
显式 executor 仍可覆盖 host 默认。

## 说明 / 范围（v0.3）

- **按 host 默认 worker。** 省略 `executor` 时：Cursor → cursor，Grok Build → grok，ZCode → zcode，
  Codex → codex，Claude Code → claude。指名即可覆盖。未知名称会立即失败。
- **同步工具。** `workflow()` 运行到完成再返回（v1）。带 task 通知的后台执行是 v2 增强。
- **本地证据。** `.odw/` 产物包含工作流脚本、prompt 和 agent 响应；新建的 run 文件仅 owner
  可读写。请保持 `.odw/` 被 gitignore。
- **没有 ultracode 自动决策。** 推荐是被动的——skill 和工具描述告诉模型何时适合用工作流。
  由模型决定；不强制注入任何东西。
- **遥测。** `zcode_result` 信封目前把 `costUsd`/`inputTokens`/`outputTokens` 报为 null
  （`telemetryAvailable: false`）。在 zcode launcher 填上这些字段之前，插件如实报 0。

许可证：MIT。
