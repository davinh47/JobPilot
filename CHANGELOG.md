# Changelog

## 0.3.0 — 2026-09-29

### Focus workspace / Focus 工作台

- Rebuilt the workspace around white and ice-gray surfaces, clear typography, restrained cobalt accents, and horizontal navigation. Phone layouts use labeled bottom tabs and an accessible More menu.
- Reshaped discovery into a job index and decision workspace; compact screens support moving between the list and a focused detail view with focus restoration.
- Added a wide-screen resume workspace with section navigation, structured fields, and an explicitly labeled saved PDF preview. Existing resume export templates are unchanged.
- Unified forms, settings, pipeline, interviews, materials, notifications, and authentication screens, including responsive spacing and keyboard focus behavior.
- Added an expandable application-flow summary and SVG download. Counts come from saved application records and recorded status transitions. Common stages are shared, status-edit loops are simplified, and each stage shows how many applications remain there. Branches have separate space and paths end at their actual current stage. Missing history and folded long histories are identified.
- Added flow-layout regression coverage and responsive navigation, dialog, form, and overflow checks.

中文版：

- 全面采用白色与冰灰工作区、清晰字级和克制的钴蓝强调色；桌面顶部导航，手机带文字的底部导航与更多菜单。
- 岗位发现重构为列表与决策详情工作区；小屏支持列表/详情切换，并恢复选中岗位的键盘焦点。
- 宽屏简历编辑器采用模块导航、结构化字段和已保存 PDF 预览三栏布局；原有导出模板保持不变。
- 统一表单、设置、申请进度、面试、材料、通知和登录页面，优化响应式布局和键盘交互。
- 新增按需展开的申请流向图及 SVG 下载。仅依据已保存的申请记录与状态变化绘制；合并重复阶段和回改循环，标明各阶段停留数量，分支分开排布，路径停留在真实当前阶段，明确提示缺失历史和长历史折叠。
- 补充流向布局回归测试，以及响应式导航、弹窗焦点、表单和页面溢出检查。

### Upgrade / 升级

The public `main` and `cloud` branches share the same product source. This release adds no database migration and does not change existing AI providers or application workflows. Follow the usual backup and deployment steps in the README and cloud deployment guide.

公开 `main` 与 `cloud` 分支共用产品源码。本次更新不新增数据库迁移，不改变现有 AI 服务商或申请业务流程。升级前请按 README 和云端部署文档执行常规备份与部署步骤。

## 0.2.0

- Hardened tenant ownership, extension authentication, SSRF defenses, redirects, encrypted secrets, storage deletion, and cloud configuration validation.
- Made resume history append-only with current-version compare-and-swap, restore-as-new-revision, and per-version export.
- Added prompt versioning, task-based model routing, token budgets, provider usage metrics, estimated costs, score calibration, and claim-level grounding checks.
- Added tenant-aware deduplicated background jobs, fair scheduling, bounded cron processing, retry recovery, and account-scoped reminder scans.
- Added a focused activation dashboard, claim-by-claim resume suggestion review, pagination, data export, synthetic demo data, and shared localization messages.
- Expanded tests and release/deployment/security documentation.
