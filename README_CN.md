# open-dynamic-workflows（ZCode 插件）

[English](./README.md)

面向 **ZCode** 的动态工作流编排——把一段确定性 JavaScript 脚本扇出成大量 `zcode` 子
agent。Claude Code Workflow 运行时的忠实、模型无关的复刻，打包为 ZCode 插件，因此体验
是原生的：一个 `workflow` 工具、一份编写 skill，以及一个 `/workflows` 命令。

一段动态工作流就是**编排大量子 agent 的纯 JS 脚本**。模型为任务编写脚本；插件内置的
运行时执行它，把每个 `agent()` 调用扇出成一个真实的 `zcode` 子进程。控制流（循环、分支、
扇出）在确定性 JS 里——LLM 的活只发生在叶子节点。

## 安装（ZCode 用户）

```
/plugins marketplace add atebites-hub/open-dynamic-workflows-plugin
/plugins install open-dynamic-workflows
```

然后重启 ZCode（或新开一个会话）。就这些——无需构建步骤，无需 `node_modules`。插件交付
了一个自包含的 `dist/mcp/server.js`。

安装后，一个会话会获得：
- 一个 **`workflow` 工具**——模型编写脚本并调用 `workflow({ script: "..." })`；它运行到
  完成，返回脚本的返回值。
- 一份 **`$open-dynamic-workflows` skill**——编写指南（何时用工作流、`meta`/`agent()`/
  `pipeline()`/`parallel()` 契约、成熟的形态）。
- 一个 **`/open-dynamic-workflows:workflows`** 斜杠命令——列出并恢复当前项目里的 run。

## 工作原理

```
模型编写一段 JS 工作流脚本
  └─ 调用 workflow({ script })
      └─ 插件的 MCP server（dist/mcp/server.js）
          └─ ODW 运行时：runWorkflow({ executors: { zcode: zcodeExecutor } })
              ├─ 每个 agent({executor:'zcode'}) spawn `zcode --prompt …`（ZCODE_ODW_PROTOCOL=1）
              ├─ parallel()/pipeline() 负责编排，journal 持久化结果
              └─ 返回脚本的 `return` 值 + run 元数据
```

`zcode` 执行器按名 spawn 用户**已安装的 `zcode`**（取 `PATH` 上的那个），并带
`ZCODE_ODW_PROTOCOL=1`，使 launcher 输出机器可读的 `zcode_result` 信封。每个 agent 是一
个真实的模型 turn。Run 可恢复：已完成的 agent 从 journal 零 token 重放。

## 一段最小工作流

```js
export const meta = { name: 'demo', description: '两个并行的 zcode agent' }

const results = await parallel([
  () => agent('2+2 等于几？只回复数字。', { executor: 'zcode', label: 'math' }),
  () => agent('说一颗红色的行星。一个词。', { executor: 'zcode', label: 'trivia' }),
])
return { results }
```

调用 `workflow({ script: "<上面这段>" })`，工具返回 `{ value: { results: [...] }, runId, ok, ... }`。

完整的编写契约（phase、schema、pipeline 与 parallel 的取舍、对抗式校验 / 评审团 /
直到搜干等形态）见 `$open-dynamic-workflows` skill。

## 仓库结构

本仓库**既是 marketplace 也是插件**（`marketplace.json` 用 `"source": "./"`）。

```
├── marketplace.json                # marketplace 清单（本仓库 = 插件）
├── .zcode-plugin/plugin.json       # ZCode 插件清单
├── .claude-plugin/plugin.json      # Claude Code 兼容镜像
├── .mcp.json                       # 声明 stdio MCP server
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
npm run setup    # 初始化 submodule + npm install + 构建 ODW + esbuild → dist/mcp/server.js
npm run smoke    # 构建产物的独立 JSON-RPC 冒烟测试
npm run build    # 只重新打包（跳过 submodule 初始化）
```

构建（`scripts/build.mjs`）用 esbuild 把 ODW 及其唯一依赖（`ajv`）内联进单个 ESM 文件，
与 android-emulator 插件的模式一致。交付给用户的产物不含 `node_modules`。

## 说明 / 范围（v0.1）

- **仅 zcode worker。** 插件注册 `{ zcode: zcodeExecutor }`。脚本里指定别的执行器会以
  ODW 清晰的 "unknown executor" 报错失败。Claude/codex 支持以后通过 `userConfig` 开关接入。
- **同步工具。** `workflow()` 运行到完成再返回（v1）。带 task 通知的后台执行是 v2 增强。
- **没有 ultracode 自动决策。** 推荐是被动的——skill 和工具描述告诉模型何时适合用工作流。
  由模型决定；不强制注入任何东西。
- **遥测。** `zcode_result` 信封目前把 `costUsd`/`inputTokens`/`outputTokens` 报为 null
  （`telemetryAvailable: false`）。在 zcode launcher 填上这些字段之前，插件如实报 0。

许可证：MIT。
