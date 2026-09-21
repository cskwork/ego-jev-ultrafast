# ego-jev 测评报告（开源前验证）

测试日期：2026-09-21 · 环境：Ego Lite 0.5.0.32（前台真实标签页，带登录态）· Jev：TYPESAFE_MODEL=jev-latest · 原始日志：`bench/results/*.log`

## 方法

- 固定任务 × 多 text-helper 模型 × 2 轮（HN 任务不调用 text 模型，只跑 1 轮作纯 Jev 基线）。
- 指标：任务成功率、总耗时、每步 Jev 决策延迟、text-helper 延迟。无任何美化，失败原始记录。

## 结果矩阵（中位数）

| 模型 | 任务 | 成功率 | 步数 | Jev/步 | text 生成 | 总耗时 |
|---|---|---|---|---|---|---|
| —（纯 Jev 基线） | HN 开评论区 | 1/1 ✅ | 1 | 1912ms | — | **2.7s** |
| qwen3.8-flash | wiki 搜索开条目 | 4/4 ✅ | 2 | ~1100ms | **~2900ms** | **~12.2s** |
| qwen3.8-max | wiki 搜索开条目 | 3/4 ⚠️ | 2 | ~1200ms | ~3300ms | ~9.9s |
| glm-4.5-air | wiki 搜索开条目 | 4/4 ✅ | 2 | ~1050ms | ~4350ms | ~10.6s |
| glm-4.6 | wiki 搜索开条目 | 4/4 ✅ | 2 | ~1050ms | ~6900ms | ~16.5s |
| qwen3.8-flash | **Google Flights 完整搜索** | **1/1 ✅** | 10 | ~800ms | ~8.3s | **60.7s** |

qwen3.8-max 唯一 1 次失败是 TypeSafe API 网络抖动（`Model connection failed`，发生在 Jev 调用处，与该模型无关），重跑即过。

## 结论

1. **速度核心主张成立**：Jev 决策每步中位数 0.6–1.9s，一步一请求（操作+目标同时出）。
   click-only 任务端到端 2.7s。瓶颈不在 Jev，而在 text-helper（2.1–9s/次）
   和 Ego 前台标签页的页面动态（stale 重观察）。
2. **text-helper 推荐 qwen3.8-flash**：最快（中位 ~2.9s）且 4/4 稳定；
   glm-4.6 最慢（~6.9s）。代码对四家端点（z.ai / DashScope）均开箱兼容。
3. **真实复杂流程可走通**：Google Flights 10 步全流程 done（含 autocomplete、
   日历、搜索提交），60.7s——比原版 7s 慢，差异来自 text-helper 延迟、
   Ego SDK 往返和为前台菜单动画加的 settle 等待，换来的是「跑在你自己的
   浏览器、带你的登录态」。
4. **护栏按设计触发**：过期日期目标会空转→预算硬上限停机；高危词动作
   fail-closed；跨域即停。全部有日志佐证。

## 已知限制（须写进开源 README）

- 日期选择器等复合 widget 仍是脆弱点（继承自原版）；过期/不可订日期会导致空转直至预算停机（fail-safe，不会乱点）。
- 不支持文件上传、canvas、iframe、复杂键盘组件；web-only（需要 DOM）。
- 需要 TYPESAFE_API_KEY（Jev 为托管闭源 API；执行框架本身开源）。
- Ego 视口即窗口大小，窄窗口会增加 scroll 步数。
