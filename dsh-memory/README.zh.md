# dsh-memory

[English](README.md) | 中文

有边界的策展式记忆：两个字符上限固定的存储，以 `MEMORY.md` / `USER.md` 持久化；每个会话注入一条冻结的 user-role 上下文消息；写入经过威胁扫描；完成轮次之后由后台审查分支来整理条目。

这是一个独立的 profile 插件（与 `dsh-cost-meter` 同一模式），不是官方仓库的包。

## 安装与接线

源码位于 harness 仓库之外，通过 `link:` 依赖挂进 dsh profile：

```json
// ~/.dsh/profiles/<profile>/package.json
{
  "dependencies": {
    "dsh-memory": "link:/Users/ymchen/.dsh/profiles/plugins/dsh-memory"
  }
}
```

profile 的 bundle patch 会挂上两行 Host 插件：`dsh-memory`（包根，Web 客户端扫描只认这个精确包名）和 `dsh-memory/settings`（HTTP 路由 + settings 命名空间）。不要再在 agent preset 里挂一次 `dsh-memory`：第二次包根行会在 `tools.register('memory')` 上冲突，而只挂在 preset 里则客户端扫描看不到它。

本地构建与测试：

```sh
npm install        # peer 依赖在运行时由 profile 提供；devDeps 供构建/测试
npm run build      # tsc --noEmit && tsdown -> lib/index.js
npm test           # vitest 单元测试
```

## 存储与持久化

插件在 `MemoryStore.defaultDir()` 挂载一个共享的 `MemoryStore` —— `$DSH_HOME/memories/`（缺省回退到 `~/.dsh/memories`）。两个目标对应文件：

| 目标 | 文件 | 默认字符上限 |
|---|---|---|
| `memory` | `MEMORY.md` | 2200 |
| `user` | `USER.md` | 1375 |

条目以 `\n§\n`（`ENTRY_DELIMITER`）分隔，可以是多行，加载和每次重载时都会去重。所有写入都经由原子写入服务在锁内完成；写入前存储会重新读取文件，若文件不可读（`read_failed`）或相对上次读取已漂移（drift），则拒绝本次操作。漂移的文件会先备份为 `<file>.bak.<epoch>`，不会被直接覆盖。

每个条目在快照构建时和写入时都会经过严格范围（prompt 注入标记、外泄 URL、可疑命令）的威胁扫描；命中即拒绝写入。磁盘上已被污染的条目在快照中会替换为 `[BLOCKED: …]` 占位符，但存活条目列表保留原始文本。

## memory 工具

`dispatchMemoryTool` / `toMemoryToolArgs`（schema.ts）校验模型侧参数并路由到存储：

- `add` —— 追加一条；完全重复的条目以 `Entry already exists (no duplicate added).` 成功返回。
- `replace` —— 替换唯一匹配的条目；匹配到多条时返回匹配预览并拒绝。
- `remove` —— 删除唯一匹配的条目。
- `operations` —— 全有或全无的批处理（`add` / `replace` / `remove` 项）；字符上限只在最终状态上检查，因此一次调用可以既腾出空间又新增条目。

溢出和零匹配失败会计入每轮的整理预算（consolidation budget）。前三次失败原样返回、附带自纠指引；第四次返回终止结果 `{ success: false, done: true, error: "Memory consolidation failed …" }`，让卡住的循环停下来。任何一次成功都会清零计数，且每次写入成功都以 `Write saved. This update is complete — do not repeat it.` 收尾。

## 冻结快照

`renderContextBlock` 返回的是 `loadFromDisk()` 时刻捕获的块，绝不是实时状态。插件在会话首次进入 Step 时，将它作为 plugin-source user-role 消息插入一次。会话中途的写入会落盘，但不会改变该消息；新创建的会话会取得创建时刷新后的快照。若 compaction 将该消息从模型可见 surface 替换，下一次进入 Step 时会再次插入同一份冻结快照。

## 后台审查

每一条用户来源的 `user/message`（委派会话除外）都会让该会话的计数器加一；达到 `nudgeInterval` 时武装一个待处理审查。会话一进入 live，或插件挂载扫到已有 live 会话时，就会写入 `$DSH_HOME/memories/.review-progress.json`，因此第一轮尚未结束就刷新浏览器仍能看到剩余轮次。恢复的会话按已完成用户轮次水合计数器（`prior % interval`）。被武装的审查在下一个正常完成的 `turn/end` 时启动：`runMemoryReview` 以该会话最后一次路由到的请求路由完整回放会话，把审查指令作为最后一条用户消息追加进去，并以仅有 memory 工具的循环运行，直到模型不再调用工具或达到 `reviewMaxIterations`。每个会话同一时间只跑一个审查；会话销毁会中止分支并清理状态。

配置字段（均经校验，可在 cordis.yml 中覆盖）：

| 字段 | 默认值 | 边界 | 含义 |
|---|---|---|---|
| `memoryCharLimit` | 2200 | 最小 1 | `MEMORY.md` 预算 |
| `userCharLimit` | 1375 | 最小 1 | `USER.md` 预算 |
| `nudgeInterval` | 10 | 最小 0 | 两次武装审查之间的用户轮次数；0 关闭审查 |
| `reviewMaxIterations` | 16 | 最小 1 | 每个审查分支的模型步数上限 |
| `reviewEnabled` | true | — | 后台审查的总开关 |

## Model Experience

### 冻结快照上下文

#### What the model sees

会话首次进入 Step 时，模型会收到一条 plugin-source user-role 消息，其中每个非空目标各有一个冻结快照块。该消息留在后续请求的派生历史中；空目标不新增消息。请求 header 的 system prompt 不包含此快照。

##### Memory snapshot block layout

```markdown
══════════════════════════════════════════════
MEMORY (your personal notes) [<pct>% — <current>/<limit> chars]
══════════════════════════════════════════════
<entry>
§
<entry>
```

#### Token effect

每个活跃 surface 仅有一条受两个存储上限约束的 user-role 消息（默认 2200 + 1375 字符）。会话中的写入不会改变冻结消息。

#### KV Cache effect

该注入消息会成为稳定的早期历史节点。新会话的磁盘条目不同会从该消息开始改变历史；请求前缀中更早的内容仍可复用。

### Memory 工具结果

#### What the model sees

成功以 `note: "Write saved. This update is complete — do not repeat it."` 收尾，并附形如 `<pct>% — <current>/<limit> chars` 的 `usage` 字符串。重复添加返回 `Entry already exists (no duplicate added).`。整理失败会携带实时 `current_entries` 供模型自纠；同一轮连续第四次失败返回 `Memory consolidation failed <n> times this turn. Stop retrying memory calls — …`。批处理错误以 `Operation <i> (<action>): …` 为前缀，并声明没有应用任何操作。

#### Token effect

仅追加；每次调用贡献参数和一个小结果。失败结果会内嵌完整的当前条目列表，其体量受存储上限约束。

#### KV Cache effect

仅追加；新的工具轮次跟在可复用的请求前缀之后。

### 后台审查分支

#### What the model sees

一个独立于会话的模型请求，走该会话的最后一条路由：经 `deriveMessages` 回放会话，并把审查指令作为最后一条用户消息追加，只提供 memory 工具。分支的转录不会回到发起会话的模型上下文。

##### Memory review directive (final user message)

```markdown
Review the conversation above and consider saving to memory if appropriate.

Focus on:
1. Has the user revealed things about themselves — their persona, desires, preferences, or personal details worth remembering?
2. Has the user expressed expectations about how you should behave, their work style, or ways they want you to operate?

每次写入前先检查现有条目并做整合。若现有条目应合并、替换、压缩或删除，不得新增重复或语义重叠的事实。仅保留稳定、可复用的事实和约定；当一条紧凑事实足以保留有效信息时，删除陈旧、冗余和时间线式细节。若没有值得保存的内容，只说 'Nothing to save.' 并停止。

You can only call the memory tool. Other tools will be denied at runtime — do not attempt them.
```

#### Token effect

不会让发起会话变长；开销完全落在分支请求里，由 `reviewMaxIterations` 模型步数封顶。审查原子保存条目后，浏览器仅可从来源会话读取一次折叠通知，其中只列出已提交的新增和移除条目。通知只存在于当前进程，读取即删除；它不写日志、不参与重放或重连恢复、不进入模型请求，也不会刷新冻结快照。

#### KV Cache effect

独立模型请求；与它审查的会话不共享任何缓存位置。

## Known Limitations and Deferred Work

- **没有写入审批门** —— 上游的写入确认流程刻意不移植；审查分支和实时工具调用的记忆写入都无需人工审阅即可落盘。
- **快照按会话冻结** —— 会话中途的写入是持久的，但对该会话的后续请求不可见；只有新创建的会话会得到刷新后的快照。
- **审查只在完成的轮次之后运行** —— 中止或错误终止的轮次永远不武装审查；解析不出模型路由的会话静默跳过。
- **每个 DSH_HOME 一个共享存储** —— 同一 home 下的所有会话和预置读写同两个文件；没有按工作区或按 agent 的分区。
- **没有同步或保留策略** —— 文件就是本地纯文本；唯一的备份是漂移产生的 `.bak.<epoch>` 副本，也不会清理旧备份。
- **模型侧文本固定为英文** —— 工具描述、结果注记和审查指令是行为契约的一部分，不做本地化。
