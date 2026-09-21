# jev-ego — jev-ultrafast 的 Ego 浏览器移植版

把 [browser-use/jev-ultrafast](https://github.com/browser-use/jev-ultrafast)（MIT）的
快速浏览器 agent 从「Python + browser-harness + 系统 Chrome」移植到
「**Node 单文件 + ego-browser SDK + 你的 Ego 浏览器**」。

核心机制不变：DOM 快照 → 编号动作表 → TypeSafe (Jev) 一次请求同时选
「操作 + 目标元素」（通常 0.3–2.5s/步），小模型只在需要打字时生成字段文本。

## 文件

| 文件 | 说明 |
|---|---|
| `jev-ego.js` | 全部逻辑：model / driver / agent loop / CLI（snapshot.js 已内联） |
| `snapshot.js` | 原版 DOM 快照脚本，**逐字未改**（重新内联：改它后要重新生成 jev-ego.js） |
| `run.sh` | 启动包装：把配置/密钥以 `JEV_ENV` 头注入 stdin（ego nodejs 不继承 shell 环境） |

## 用法

```bash
cd ~/pi-agent/deliverables/jev-ego

# click-only 任务（只需 TYPESAFE_API_KEY）
JEV_URL=https://news.ycombinator.com \
JEV_GOAL="Open the comments page of the top-ranked story" \
./run.sh

# 需要打字的任务（再加一个 OpenAI 兼容 text helper）
export TEXT_MODEL_API_KEY=<你的 key>
export TEXT_MODEL_BASE_URL=https://api.z.ai/api/coding/paas/v4   # GLM 实测可用
export TEXT_MODEL=glm-4.6 TEXT_MODEL_REASONING=omit
JEV_URL="https://en.wikipedia.org/wiki/Main_Page" \
JEV_GOAL="Search Wikipedia for 'Gödel, Escher, Bach' and open the article about the book" \
./run.sh
```

可选环境变量：`TYPESAFE_MODEL`（默认 jev-latest）、`DEBUG=1`（打印每次 predict）、
`JEV_KEEP=1`（结束后保留结果标签页；默认成功收尾时关闭本 space 的 agent 标签页）、
`JEV_AUTO=1`（放行高危动作闸，见下）、`JEV_SPACE`（task space 名，默认 jev-ego）。

## 复审后新增的护栏（相对原版的增强）

1. **高危动作闸（fail-closed）**：动作 label/href/value 命中支付/购买/删除/发送/
   转账/授权/登录类关键词（中英文）时，run 直接 blocked 并打印动作详情，
   不执行。人工接管标签页处理，或显式 `JEV_AUTO=1` 放行。
2. **跨域即停**：动作后页面 eTLD+1 与起始站不同 → blocked（防钓鱼跳转后继续填表）。
3. **禁下载**：启动时 `Page.setDownloadBehavior deny`。
4. **错误分类**：用户接管 space / safety-timeout 不再被误诊为「页面导航中」，
   立即停且**不 finish**（保留现场；finish 只在正常 done/blocked 路径调用）。
5. **select 中断即致命**：下拉框 hit-test 内已改 DOM，evaluate 中断直接报错
   停止（原版语义），不会自动重试。
6. **URL scheme 白名单**：只允许 http/https。
7. **JS dialog 检测**：observe 重试前检查并 dismiss 阻塞的 alert/confirm。

已知残余风险：hit-test 与 CDP 点击之间存在 Node 往返的 TOCTOU 窗口（毫秒级，
靠动作表 guard + 高危闸兜底）；DONE 判定由同一模型自述，语义欺骗面与原版相同；
输入走 raw CDP 而非 ego 原生 mouse/keyboard——有意保留，与原版时序逐行一致
（ego 文档允许 wrapper 不可靠时用 cdp，此处理由是移植保真）。
看到 `[ego-browser:notice] update available` 时手动跑 `ego-browser upgrade`。

## 与原版的差异（有意为之）

1. **驱动层**：browser-harness/CDP → ego SDK（`taskSpace` / `page.evaluate` /
   `page.cdp("Input.*")`）。点击/打字仍是 CDP 原始输入 + JS hit-test，逻辑逐行对应。
2. **去掉** `Emulation.setDeviceMetricsOverride`（1120×780）和
   `Emulation.setFocusEmulationEnabled`：Ego 标签页是前台真实标签页，视口即窗口大小。
   窗口过窄时视口内可交互元素会变少，可能多几步 scroll。
3. **去掉截图录制**（record_dir/screenshots）：原版只用于 demo 回放，执行链路不依赖。
4. **配置注入**：ego nodejs runtime 不继承 shell 环境变量，密钥经 run.sh 从 stdin
   注入（不进 argv、不落盘）。
5. `TEXT_MODEL_REASONING=omit`：新增选项，发送完全不带 reasoning 字段的请求体
   （GLM 等非 DeepSeek/OpenAI 端点需要）。
6. **清理**：结束后 `task.finish({ keep })` 关掉自己 space 的 agent 标签页；
   启动时清理上次崩溃残留的标签页。

## 自测结果（2026-09-20，复审修复后复测）

| 场景 | 结果 | 耗时 | 说明 |
|---|---|---|---|
| HN 打开头条评论区 | ✅ done | 2.4s | 1 步 CLICK，conf 0.99 |
| Wikipedia 搜索 GEB 并打开条目 | ✅ done | 6.7s | TYPE_TEXT + CLICK；GLM 文本 2.8s |
| Google Flights 苏黎世→伦敦单程 | ✅ done（未来日期） | 60.7s | 10 步全流程：票型→Zurich→London→2026-10-20→Search→结果页。**注意**：用 2026-09-20 会卡日历——该日期在测试时已是「昨天」（原版 demo 发布于 9/16，当时是未来日期），过期日期不可选，模型选最近可订的 9/21 后与 DONE 条件冲突空转。属测试目标缺陷，非移植缺陷 |

Ego 适配中新增的两处 settle 逻辑（原版没有的）：
1. 点击后观察上限 50ms → **300ms**（Google 菜单关闭动画比原版环境慢，
   50ms 时观察到的仍是开着的菜单，Jev 会误判 BLOCKED）。
2. 点击后若动作表 ≤5 项（判定为遮罩/动画中间态），**等 400ms 重新观察一次**
   再让模型决策。

已知边界（与原版一致）：不支持文件上传、canvas、iframe、复杂键盘组件；
日期选择器这类复合 widget 是原版也最脆弱的部分，在 Ego 前台视口下
重渲染更频繁，stale 率更高。

## 安全模型（继承原版）

- 页面文本只作为「不可信数据」进 prompt，三条 rules 明确禁止当指令执行。
- 模型只能返回「编号动作表里的下标」，不能生成选择器/代码；执行前 JS 重新
  hit-test + guard 比对（元素身份、disabled、可见性、覆盖检测），页面变了就
  StalePage 重观察，绝不对过期页面执行动作。
- DONE/BLOCKED 前强制 fresh() 校验；连续 3 步页面无变化自动 blocked；
  60 步 / 120 次模型调用双预算硬上限。
