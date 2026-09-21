# ego-jev — jev-ultrafast 的 Ego Lite 移植版

把 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)（MIT）的
快速浏览器 agent 从「Python + browser-harness + 系统 Chrome」移植到
「**Node 单文件 + ego-browser CLI + 你自己的 Ego Lite 浏览器**」。

> **非官方项目**：本项目与 CitroLabs（Ego Lite 开发方）和 browser-use 均无隶属
> 关系，仅为兼容两者的独立移植。"Ego" 相关名称仅用于指明兼容对象。

核心机制不变：DOM 快照 → 编号动作表 → TypeSafe (Jev) 一次请求同时选
「操作 + 目标元素」（实测中位 0.6–1.9s/步，见 `bench/BENCHMARK.md`），
小模型只在需要打字时生成字段文本。

## ⚠️ 数据流披露（使用前必读）

本工具运行在你的**真实登录态浏览器**里，为了让模型做决策，它会把页面数据
发往第三方 API：

- **每一步**：页面 URL、标题、最多 6000 字可见文本、控件标签、**普通输入框的
  当前值**（password/file/hidden 类型除外）→ 发往 `api.typesafe.ai`。
- **需要打字时**：相同页面上下文 + 任务目标 + 最近动作 → 发往你配置的
  `TEXT_MODEL_BASE_URL`（任意 OpenAI 兼容端点，强制 https）。
- **终端输出**：每步的动作标签、填写的文本、最终 URL 会打印到 stdout
  （API Key 不会出现在任何输出里）。

**请勿在含敏感信息的页面上运行本工具**，除非你信任上述数据流向。
使用者需自行遵守 TypeSafe 及所选 text-helper 服务商的条款。

## 文件

| 文件 | 说明 |
|---|---|
| `jev-ego.js` | 全部逻辑：model / driver / agent loop / CLI（snapshot.js 已内联） |
| `snapshot.js` | 上游 DOM 快照脚本，**逐字未改**（改它后要重新内联进 jev-ego.js） |
| `run.sh` | 启动包装：把配置/密钥以 `JEV_ENV` 头注入 stdin（ego nodejs 不继承 shell 环境） |
| `bench.sh` / `bench/` | 多模型测评脚本与报告 |

## 用法

前置：安装 [Ego Lite](https://github.com/citrolabs/ego-lite) 并让其保持运行；
获取 TypeSafe API Key。

```bash
git clone <this-repo> && cd ego-jev
export TYPESAFE_API_KEY=<你的 TypeSafe key>

# click-only 任务
JEV_URL=https://news.ycombinator.com \
JEV_GOAL="Open the comments page of the top-ranked story" \
./run.sh

# 需要打字的任务（再加一个 OpenAI 兼容 text helper）
export TEXT_MODEL_API_KEY=<text helper 的 key>
export TEXT_MODEL_BASE_URL=https://api.z.ai/api/coding/paas/v4   # GLM 实测可用
export TEXT_MODEL=glm-4.6 TEXT_MODEL_REASONING=omit
JEV_URL="https://en.wikipedia.org/wiki/Main_Page" \
JEV_GOAL="Search Wikipedia for 'Gödel, Escher, Bach' and open the article about the book" \
./run.sh
```

可选环境变量：`TYPESAFE_MODEL`（默认 jev-latest）、`DEBUG=1`（打印每次 predict）、
`JEV_KEEP=1`（结束后保留结果标签页；默认成功收尾时关闭本 space 的 agent 标签页）、
`JEV_AUTO=1`（放行高危动作闸，见下）、`JEV_SPACE`（task space 名，默认 jev-ego）。

## 护栏（相对上游的增强）

这些护栏是**缓解措施，不是保证**；它们缩小风险面，但不能替代人的监督。

1. **高危动作关键词闸（默认阻断）**：动作 label/value 命中支付/购买/删除/发送/
   转账/授权/登录类关键词（中英文）时，run 直接 blocked 并打印动作详情。
   注意：这是关键词拒绝表，措辞新颖的高危按钮可能绕过；快照不含 href，
   链接目标地址不在检查范围内。显式 `JEV_AUTO=1` 可放行。
2. **跨域即停**：动作后页面主机名不是起始主机或其子域 → blocked。
   （为主机名精确比对，非完整 public-suffix 判定；起始重定向不检查。）
3. **下载拦截（best-effort）**：启动时尝试 `Page.setDownloadBehavior deny`，
   个别目标不支持时会静默跳过。
4. **错误分类**：用户接管 space / safety-timeout 不再被误诊为「页面导航中」，
   立即停且不 finish（保留现场；finish 只在正常 done/blocked 路径调用）。
5. **select 中断即停**：下拉框 hit-test 内已改 DOM，evaluate 中断直接报错
   停止（上游语义），不会自动重试。
6. **URL scheme 白名单**：起始 URL 只允许 http/https。
7. **JS dialog 检测**：observe 重试前检查并 dismiss 阻塞的 alert/confirm。

已知残余风险：hit-test 与 CDP 点击之间存在 Node 往返的 TOCTOU 窗口（毫秒级，
靠动作表 guard + 关键词闸缓解）；DONE 判定由同一模型自述，存在语义欺骗面
（与上游相同）；输入走 raw CDP 而非 ego 原生 mouse/keyboard——为与上游执行
时序保持一致而有意保留（ego 文档允许 wrapper 不可靠时用 cdp，此处理由是移植保真）。
看到 `[ego-browser:notice] update available` 时手动跑 `ego-browser upgrade`。

## 与上游的差异（有意为之）

1. **驱动层**：browser-harness/CDP → ego SDK（`taskSpace` / `page.evaluate` /
   `page.cdp("Input.*")`）。点击/打字仍是 CDP 原始输入 + JS hit-test，执行序列
   与上游对应。
2. **去掉** `Emulation.setDeviceMetricsOverride`（1120×780）和
   `Emulation.setFocusEmulationEnabled`：Ego 标签页是前台真实标签页，视口即窗口大小。
   窗口过窄时视口内可交互元素会变少，可能多几步 scroll。
3. **去掉截图录制**（record_dir/screenshots）：上游只用于 demo 回放，执行链路不依赖。
4. **配置注入**：ego nodejs runtime 不继承 shell 环境变量，密钥经 run.sh 从 stdin
   注入（不进 argv、不由本脚本落盘）。
5. `TEXT_MODEL_REASONING=omit`：新增选项，发送完全不带 reasoning 字段的请求体
   （GLM 等非 DeepSeek/OpenAI 端点需要）。
6. **清理**：正常收尾时 `task.finish({ keep })` 关掉自己 space 的 agent 标签页；
   启动时清理上次崩溃残留的标签页；异常/用户接管路径不动 space。

## 自测结果（复审修复后复测）

| 场景 | 结果 | 耗时 | 说明 |
|---|---|---|---|
| HN 打开头条评论区 | ✅ done | 2.4s | 1 步 CLICK，conf 0.99 |
| Wikipedia 搜索 GEB 并打开条目 | ✅ done | 6.7s | TYPE_TEXT + CLICK；GLM 文本 2.8s |
| Google Flights 苏黎世→伦敦单程 | ✅ done（未来日期） | 60.7s | 10 步全流程：票型→Zurich→London→2026-10-20→Search→结果页。**注意**：目标日期必须是未来日期——过期日期不可订，模型会选最近可订日期并与 DONE 条件冲突，空转至预算上限停机（fail-safe，不会乱点） |

Ego 适配中新增的两处 settle 逻辑（上游没有的）：
1. 点击后观察上限 50ms → **300ms**（前台标签页的菜单关闭动画更慢，
   50ms 时观察到的仍是开着的菜单，Jev 会误判 BLOCKED）。
2. 点击后若动作表 ≤5 项（判定为遮罩/动画中间态），**等 400ms 重新观察一次**
   再让模型决策。

已知边界（与上游一致）：不支持文件上传、canvas、iframe、复杂键盘组件；
日期选择器这类复合 widget 是上游也最脆弱的部分，在 Ego 前台视口下
重渲染更频繁，stale 率更高。

## 安全模型（继承上游）

- 页面文本只作为「不可信数据」进 prompt，rules 明确禁止当指令执行。
- 模型只能返回「编号动作表里的下标」，不能生成选择器/代码；执行前 JS 重新
  hit-test + guard 比对（元素身份、disabled、可见性、覆盖检测），页面变化
  会触发 StalePage 重观察，决策随旧页面一起作废。
- DONE/BLOCKED 前强制 fresh() 校验；连续 3 步页面无变化自动 blocked；
  60 步 / 120 次模型调用双预算硬上限。

## 许可与归属

MIT（见 `LICENSE`）。本项目是
[browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast) 的移植，
`snapshot.js` 逐字来自上游，上游完整 MIT 许可文本已附在 `LICENSE` 的
THIRD-PARTY NOTICES 一节。Ego Lite 为
[CitroLabs 的 MIT 项目](https://github.com/citrolabs/ego-lite)，本项目仅通过
其公开 CLI 调用，不包含其代码。TypeSafe (Jev) 为托管服务，需自备账号与 Key。
