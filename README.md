# dsh-handoff

[![CI](https://github.com/zhenbang1216/dsh-handoff/actions/workflows/ci.yml/badge.svg)](https://github.com/zhenbang1216/dsh-handoff/actions/workflows/ci.yml)

把 DeepSeek Harness 的一个会话，变成一份**可以交给下一个会话的交接文档**。

上下文快用完、任务还没做完，或者你要离开一段时间再回来——`dsh-handoff` 会读一遍当前会话，生成一份 markdown：任务是什么、已经完成了什么、现在进行到哪、下一步做什么、哪些没做完、踩过哪些坑、关键文件与命令在哪，最后附一段可以直接粘贴给下一个会话的开场白。

- **`/handoff` 命令**：随时手动生成，可以带一个关注点（`/handoff 重点写测试`）。
- **`handoff` 工具**：模型自己也能调用——上下文将满时，它可以主动把现状写下来。
- **侧边栏「交接文档」页**：列出历史文档、预览内容，并能为任意活动会话一键生成。
- 文档落到会话工作目录的 `.dsh/handoff/`，同时维护一份 `latest.md`，下一个会话直接读它就行。

## 安装

```sh
# 从本仓库源码安装（目录即插件；lib/ 是随仓库提交的构建产物，clone 即可用）
git clone https://github.com/zhenbang1216/dsh-handoff.git
dsh plugin --profile desktop add file:$PWD/dsh-handoff

# 发布到 npm 之后
dsh plugin --profile desktop add dsh-handoff
```

安装会把包加进该 profile 的 `dsh.profile.bundles`，重启 Harness（或在该 profile 的插件页禁用再启用）后生效。

如果 `dsh plugin` 因为 profile 的 pnpm store 路径不一致而失败（换过盘符或 Node 版本时常见），可以直接手工装：把仓库目录以 junction/软链接放到 `<profile>/node_modules/dsh-handoff`，再把包名加进 `package.json` 的 `dsh.profile.bundles`。本机的 `desktop` profile 就是这么装的。

## 使用

在输入框输入：

```text
/handoff
/handoff 重点说明数据库迁移为什么停在第三步
```

或者直接跟模型说「生成交接文档」，它会调用 `handoff` 工具。工具也可以带关注点：

```text
先别改代码，调用 handoff 工具，把测试那部分写详细一点。
```

生成后，会话记录里不会多出任何模型消息——这是一次辅助调用，不是一轮对话。

### 新会话接续

在**新会话**里把上一份文档读进上下文：

```text
/handoff resume                 # 注入 latest.md
/handoff resume handoff-20261025-214005-重构登录模块.md
```

它会以「上一个会话留下的交接文档」的身份注入一条模型可见的上下文（不是用户消息，也不开新的一轮），超过 30000 字符时截断并说明。注入来源标记为 `dsh-handoff`，便于追溯。

## 产出

```text
<工作目录>/.dsh/handoff/
├─ handoff-20261025-214005-重构登录模块.md   # v1，每次生成一份，按时间排序
├─ handoff-20261026-085833-补测试.md         # v2，头部记着 previous 指向 v1
└─ latest.md                                 # 指针：写明最新是哪一份，不是副本
```

文档结构（由提示词约束，模型逐节填写）：

| 小节 | 回答的问题 |
|---|---|
| 任务 | 这次到底要做什么 |
| 已完成 | 做完了什么，证据在哪 |
| 当前进展 | 此刻停在哪一步 |
| 下一步 | 接下来按什么顺序做 |
| 未完成 / 风险 | 什么还悬着，什么可能炸 |
| 踩坑与规避 | 走过的弯路，别再走一遍 |
| 关键文件与命令 | 接手的人该先看哪几个文件、跑哪几条命令 |
| 给下一个会话的开场白 | 可直接粘贴的一段话 |

### 版本与时间

每份文档的头信息（YAML front matter）和标题下那一行都会写明版本与新鲜度：

```yaml
created: "2026-10-26T08:58:33+08:00"      # 生成时间
updated: "2026-10-26T08:58:33+08:00"      # 最后写入时间（人工改过就跟着变）
version: 2                                  # 同一个输出目录里的第几份，从 1 开始
session-activity: "2026-10-26T08:57:12+08:00"  # 这份文档反映的对话最后活动时间
previous: "handoff-20261026-085801-….md"   # 上一份，形成链条
generator: dsh-handoff@0.3.0
```

```markdown
> v2 · 生成于 2026-10-26 08:58:33 +08:00 · 会话最后活动 2026-10-26 08:57:12 +08:00 · 上一份 `handoff-20261026-085801-….md`
```

`latest.md` 是一行指针而不是副本：

```markdown
---
kind: latest-pointer
latest: "handoff-20261026-085833-补测试.md"
version: 2
updated: "2026-10-26T08:58:33+08:00"
---
```

所以「哪份最新」有两个等价答案：看 `latest.md` 指向谁，或按文件名里的时间戳取最大。侧边栏列表里最新那份还带一个 **最新** 徽标。`/handoff resume` 会自动跟随指针；旧版本留下的「副本式 latest.md」也能正确识别。

## 界面

侧边栏里有一行 **交接文档**，点开就是整页：

- 顶部一条操作线：选会话（当前进程里活着的会话，按消息数排序展示标题）、填关注点、点「生成交接文档」；
- 左栏是该会话目录下的历史文档，按时间倒序；文件名解析成「标题 · 日期 · 大小」（如 `补测试 · 10-26 08:58 · 2 KB`），带刷新按钮；
- **最新** 徽标以 `latest.md` 指针为准——手动编辑旧文档改变修改时间，也不会抢走徽标；
- 右侧是选中文档的 **markdown 渲染预览**（标题、代码块、列表、引用、行内代码与加粗），front matter 收进可折叠的「文档信息」面板；
- 预览头部一键 **复制全文** 或 **复制开场白**（自动提取「给下一个会话的开场白」小节，交接时直接粘贴）；
- 状态反馈分色：成功绿、失败红，生成中有加载指示；
- 插件页的 `dsh-handoff` 卡片显示这次运行实际使用的配置值。

页面通过插件自己的只读 HTTP 接口拿数据（`/dsh-handoff/api/*`），走浏览器同源 Cookie，和其它 Host 请求一样受鉴权保护。视觉自适应宿主明暗主题。

## 设置

在「插件」页的 `dsh-handoff` 配置卡片里查看当前生效值；修改写进 profile 的 `cordis.patch.yml`，重新加载插件后生效：

| 选项 | 默认 | 说明 |
|---|---|---|
| `outputDir` | `.dsh/handoff` | 输出目录，相对会话工作目录；绝对路径也可 |
| `filenamePrefix` | `handoff` | 文件名前缀 |
| `writeLatest` | `true` | 同时写 `latest.md` |
| `provider` / `model` | 空 | 两者都填才生效；留空沿用会话当前模型 |
| `maxInputChars` | `48000` | 会话记录字符预算，超出时保留头尾、省略中段 |
| `maxOutputTokens` | `4096` | 生成文档的输出上限 |
| `includeToolResults` | `true` | 把工具结果写进记录（逐条截断） |
| `includeReasoning` | `false` | 把模型思考过程写进记录 |
| `language` | `auto` | `auto` 跟随对话语言，或固定 `zh` / `en` |
| `extraInstructions` | 空 | 追加给撰写器的额外要求 |

## 设计要点

- **不碰对话**：只做一次辅助模型调用（`ctx.llm.stream`），不写会话历史，不占上下文。
- **路由跟随会话**：默认用会话里最后一条助手消息实际使用的 provider/model，所以你用哪个模型，交接文档就是哪个模型写的。
- **预算内截断**：会话很长时按字符预算保留开头（任务）和结尾（最新进展），中间用显式标记说明省略了多少条——模型知道记录不完整，不会假装看过。
- **失败可解释**：provider 报错会带着原始 failure code 冒出来（如 `RATE_LIMIT`），不会悄悄生成半份文档。
- **只写事实**：提示词禁止编造，不确定的地方要求写「待确认」。

## 验证状态

在本机 `desktop` profile（DSH `0.2.1-rc.3`）上实测：

| 项 | 证据 |
|---|---|
| 宿主工具 | 在真实会话里调用 `handoff`，由 `deepseek-account/deepseek-flash` 写出文档并落到 `.dsh/handoff/` |
| HTTP 接口 | `/api/dsh-handoff/{sessions,docs,doc,config,generate}` 全部 200；`generate` 返回新文档路径与统计 |
| 侧边栏面板 | 「交接文档」一行渲染成功（截图确认），列表与 markdown 渲染预览走上述接口；预览渲染器有专项回归测试 |
| 客户端包 | 现场 boot graph 含 `dsh-handoff` 条目，bundle 由宿主提供且为本机构建 |
| 斜杠命令 | `/handoff` 注册成功，已实际生成过文档 |
| 安装 | `pnpm check:install` 全绿（依赖、bundle、两个产物、`dsh.client` 形态） |

自动化：`pnpm typecheck`、`pnpm test`（83 项）、`pnpm integration`（真实 Cordis 服务，含生成与接续）。

## 排查

先跑一次安装自检，它会逐项确认 profile 里的依赖、bundle 列表、两个产物和客户端包形态：

```sh
node scripts/check-install.mjs desktop        # 或 pnpm check:install
```

- **侧边栏没有「交接文档」**：先确认插件在「插件」页里是启用状态；禁用再启用一次会重新挂载浏览器半身。宿主侧加载失败会在同一页显示错误条目。
- **面板能打开但显示「会话列表读取失败: HTTP 404」**：宿主的 exact 路由没注册上。原因是 Connection 的服务契约随版本变过——0.2.1 线要用 `connection.registerFetchRoute(owner, route)`（旧线是 `connection.fetch.register(route)`），且 `route.path` 必须落在 `/api/<...>` 通道里、每段只允许 `[A-Za-z0-9_$.-]`，否则注册时直接被拒。本插件两者都兼容；出现 404 说明宿主加载的是旧构建，重新加载插件或重启即可。
- **命令 `/handoff` 没出现**：命令由 Web 客户端提供；无 UI 的 headless 运行里只有 `handoff` 工具。
- **生成失败并带错误码**：`NO_ROUTE` 表示会话还没有模型回复、且没有配置 `provider`/`model`；`RATE_LIMIT`、`AUTH` 等是模型服务商原样返回的失败码。
- **找不到历史文档**：列表只看当前会话工作目录下的 `outputDir`；换会话或改过 `outputDir` 后看到的是另一个目录。

## 开发

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build        # 产物：lib/index.js（宿主）+ lib/client.js（浏览器）
pnpm integration  # 在真实 Cordis 里挂真 SessionStore/CommandRuntime，跑一遍 /handoff
```

`pnpm integration` 用 0.2.1-rc.3 的真实服务跑一遍插件：注册工具、发现命令、执行 `/handoff`、写出文档，并断言会话日志里只有 `command/run` + `command/done`、没有开 turn。模型调用由脚本内的假 provider 提供——账号路由只有桌面宿主能授权。

仓库结构：

```text
src/
├─ index.ts        # 插件入口：注册工具与 /handoff 命令
├─ client/index.ts # 浏览器半身：侧边栏页面、markdown 预览渲染、配置卡片
├─ config.ts       # schemastery 配置（自动生成设置表单）
├─ generate.ts     # 路由解析 → 提示词 → 流式调用 → 落盘
├─ transcript.ts   # 会话消息 → 带预算的紧凑记录
├─ prompt.ts       # 系统提示词与小节契约（中/英）
├─ markdown.ts     # front matter、正文清洗、文件名
├─ store.ts        # 目录解析与文件读写
├─ routes.ts       # 面板的只读 HTTP 接口
├─ resume.ts       # /handoff resume：加载文档并注入新会话
├─ errors.ts       # 稳定错误码
└─ version.ts      # 包版本号，与 package.json 互校
```

## 路线图

- [x] 宿主端：`handoff` 工具、`/handoff` 命令、配置、落盘
- [x] 只读 HTTP 接口：会话列表、文档列表、文档内容、生成
- [x] 客户端：侧边栏「交接文档」页（列表 / 预览 / 一键生成）+ 配置卡片
- [x] 新会话接续：`/handoff resume [文件名]` 注入 `latest.md`
- [ ] 面板里加「接续到当前会话」按钮（需要宿主侧接入 `ctx.agents`）
- [ ] 配置卡片可编辑（接 Host 的 `configForms`）
- [ ] 上下文压力触发：接近自动压缩阈值时提示/自动生成草稿
