# open-dynamic-workflows（Grok Build + Codex + ZCode 插件）

[English](./README.md)

面向 **Grok Build、Codex 和 ZCode** 的动态工作流编排——通过原生 `workflow` 工具和编写 skill，
把一段确定性 JavaScript 脚本扇出成大量 CLI 子 agent。

一段动态工作流就是**编排大量子 agent 的纯 JS 脚本**。模型为任务编写脚本；插件内置的
运行时执行它，把每个 `agent()` 调用扇出成一个真实的 `grok`、`codex` 或 `zcode` 子进程。
控制流（循环、分支、扇出）在确定性 JS 里——LLM 的活只发生在叶子节点。

## 安装（Grok Build）

PR 合入 `main` 之前优先用本地路径：

```bash
grok plugin install /path/to/open-dynamic-workflows-plugin --trust
```

从 marketplace 安装（先添加本仓库为源）：

```bash
grok plugin marketplace add atebites-hub/open-dynamic-workflows-plugin
grok plugin install open-dynamic-workflows --trust
```

然后 `grok plugin list` / `grok plugin details open-dynamic-workflows`。新开一个 Grok
Build 会话，以加载 `workflow` 工具和 `$open-dynamic-workflows` skill。

工作室镜像上的托管 CLI 位于 `/home/box/.grok/bin`（以及 `$HOME/.grok/bin`）。把它加进
`PATH`，或设置 `GROK_BIN`。

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
          └─ ODW 运行时：runWorkflow({ executors: { grok, codex, zcode } })
              ├─ agent({executor:'grok'})  spawn `grok --prompt-file … --output-format streaming-json`
              ├─ agent({executor:'codex'}) spawn `codex exec --json …`
              ├─ agent({executor:'zcode'}) spawn `zcode --prompt …`（ZCODE_ODW_PROTOCOL=1）
              ├─ parallel()/pipeline() 负责编排，journal 持久化结果
              └─ 返回脚本的 `return` 值 + run 元数据
```

三个执行器都使用用户 `PATH` 中已安装的 CLI。grok 执行器还会在 `/home/box/.grok/bin` 与
`$HOME/.grok/bin` 存在时把它们前置到 PATH。

- **grok** — 无头 Grok Build 叶子（`grok -p` 的子进程形态）。用 `--prompt-file` 避免
  argv 过长，用 `--output-format streaming-json`（Grok 的 `json` 格式带换行，不能按行解析）。
  默认 `--permission-mode acceptEdits`，并带上适合子进程的
  `--no-subagents --no-plan --no-memory --verbatim --no-auto-update`。可用 `GROK_BIN`
  钉死二进制。已经在用 bypass 的 Palemon Director 可给 MCP 进程设置
  `GROK_ODW_PERMISSION_MODE=bypassPermissions` 和 `GROK_ODW_ALWAYS_APPROVE=1`。
- **codex** — 先用 host 提供的工作区元数据校验 `cwd`，再在 `workspace-write` 沙箱中
  跑 JSONL。覆盖模型时推理强度默认 `medium`。
- **zcode** — `ZCODE_ODW_PROTOCOL=1`。遥测字段目前为 null。

每个 agent 是一个真实的模型 turn。已完成的 agent 从 journal 零 token 重放。

## 一段最小工作流

```js
export const meta = { name: 'demo', description: '两个并行的 grok agent' }

const results = await parallel([
  () => agent('2+2 等于几？只回复数字。', { executor: 'grok', label: 'math' }),
  () => agent('说一颗红色的行星。一个词。', { executor: 'zcode', label: 'trivia' }),
])
return { results }
```

调用 `workflow({ cwd: "/项目的绝对路径", script: "<上面这段>" })`，工具返回 `{ value: { results: [...] }, runId, ok, ... }`。

完整的编写契约见 `$open-dynamic-workflows` skill。Palemon Director：用 `pipeline()` 把
许多 grok 叶子扇出去；Cursor Cloud Extra High 走 `scripts/launch-cloud-extra-high.sh`
（不要把密钥写进脚本）。

## 仓库结构

本仓库**既是 marketplace 也是插件**。

```
├── .grok-plugin/                   # Grok Build marketplace 索引 + 插件清单
├── marketplace.json                # ZCode marketplace 清单
├── .zcode-plugin/plugin.json       # ZCode 插件清单
├── .claude-plugin/plugin.json      # Claude / Grok 兼容清单
├── .mcp.json                       # 声明 stdio MCP server
├── skills/open-dynamic-workflows/  # 编写 skill
├── commands/workflows.md           # /workflows 斜杠命令
├── src/mcp/server.ts               # MCP server 源码
├── src/mcp/grok.ts                 # grok 执行器
├── dist/mcp/server.js              # 已提交的自包含打包产物
├── scripts/{build,setup,smoke}.mjs
├── scripts/run-mcp.cjs             # 跨 host 的 MCP 启动器
├── open-dynamic-workflows/         # git submodule（仅开发）
└── zcode-cli/                      # git submodule（开发便利；不打包）
```

### 面向维护者 / 贡献者

```bash
npm run setup    # 初始化 submodule + 锁定安装 + 构建 ODW + esbuild → dist/mcp/server.js
npm run smoke    # 构建产物的独立 JSON-RPC 冒烟测试
npm run build    # 只重新打包
npm run verify   # 重新打包并运行插件冒烟检查
```

## 说明 / 范围（v0.3）

- **Grok、Codex 和 ZCode worker。** 插件注册三个执行器；每个 `agent()` 仍须显式指定一个。
  未知名称会立即失败。
- **同步工具。** `workflow()` 运行到完成再返回（v1）。
- **本地证据。** `.odw/` 产物包含工作流脚本、prompt 和 agent 响应；请保持被 gitignore。
- **没有 ultracode 自动决策。** 由模型决定是否调用 `workflow`。
- **遥测。** zcode 信封目前把用量报为 null；grok 叶子在 streaming-json 的 `end` 事件里
  带上 usage（若有）。

许可证：MIT。
