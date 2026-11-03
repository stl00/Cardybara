# Cardybara 1.1.0 · local engineering preview

Not store-ready. Acceptance status and release blockers are tracked in ../docs/RELEASE.md.

Build locally: python3 scripts/package-extension.py /absolute/path/to/node
(from the repository root). Uses only Python/Node standard libraries and committed
icons. Installable ZIP has manifest.json at root. Actual ZIP is checksummed and its
worker import is tested in a mocked Chrome environment, not in real Chrome.

New permissions: storage and alarms, in addition to scripting and the same explicit
bank/Dashboard hosts. Installation/upgrade needs a separate concrete review of the
package and permissions. Localhost is deliberately not an authorized data recipient.
Never add localhost to a production package to bypass this boundary.

Bank scope: issuer + region + supported locale + currency + dashboard card ID.
Amex US/HK/CA never share a generic country-unknown tab. Duplicate known tails,
multiple bank tabs, ambiguous amounts and unpartitioned HKD/CNY containers are
skipped. Four numeric fields only: balance, available, statement, minimum.
HSBC statement is disabled pending sign-convention validation. No points, Offers,
benefits, transactions, due dates or auto-login.

Task state and results live in cardybara-state-v2, schema 2, chrome.storage.local,
restricted to trusted extension contexts. New runs serialize. Each bank has an
attempt ID, generation, tab ownership and document identity; cancelled, superseded,
navigated and late results cannot write. Alarm is a deadline fallback, not keepalive
or daily schedule. Worker restart explicitly interrupts pending jobs; retry manually.
No automatic repeated bank navigation on restart. Original/user tabs are never closed.

Popup: show progress, cancel, bank enable/disable, clear extension records, JSON
export. Disconnect deletes that bank's extension readouts; it does not revoke browser
permissions or delete historical published snapshots. Dashboard also stores its own
merged local copy. Open Dashboard while clearing to synchronize that copy, or clear
its site storage separately. Browser shutdown may delay alarms; recovery handles this
as interruption, not successful collection.

Migration: v2 has a new key and does not delete or relabel existing v1 localStorage.
Published/imported snapshots remain the fallback. Each field retains currency,
source issuer/region/page, locale, capture time, adapter version and status.
Unknown schema fails closed. No raw bank HTML or input values are stored.

Rollback: export current readings, disable/remove the preview, re-enable existing
1.0.0. Keep the archived 1.0.0 folder/ZIP. Do not import extension schema-2 JSON into
the historical full-wallet snapshot importer; these are distinct documented formats.

Release blockers and exact coverage: ../docs/EXTENSION_RELEASE.md. Complete actual
Chrome install, worker termination, panel reload, cancel/navigation and real-bank
acceptance before changing the preview label or submitting to Chrome Web Store.


Guided sign-in: refresh opens the bank website with an isolated-world Cardybara
chip. Users sign in on the bank site themselves; this extension never fills or
reads credentials. The chip watches for visible registered card tails, displays
progress, attempts one automatic read after login, and offers explicit read,
return-to-wallet and stop controls. Waiting login jobs end their current bank
read without blocking the global queue. The guide can resume that bound bank
for up to 15 minutes, with a new attempt ID and no new bank reload. New runs,
cancellation, disconnect, expiry and wrong tabs invalidate the guide.
Amex shared overview redirects are accepted only in a region-selected bound
tab; only pre-registered globally unique tails, supported locale and currency
can produce fields. Unknown/ambiguous cards are skipped. The previous Chrome
computer-use password autofill was an agent action, not an extension feature.

## 独立钱包与可选 AI 解析

`scripts/package-standalone.py` 将构建好的 React 钱包打包进扩展的 index.html。独立包不含个人数据，首次使用从“数据管理 → 导入备份”导入卡片。无需 localhost 或 GPT。规则采集维持原来的银行任务；AI 助手是单独的受控解析流程。

默认模型为 DeepSeek Flash，可切换 Gemini Flash-Lite。API 密钥仅存 chrome.storage.session，重启后清除；不会回传网站或导出。可选模型网站权限只在用户点击连接时请求。仅在预览财务片段、明确勾选接收方并点击解析后发送。AI 不能执行代码或任意点击；只可建议同域无查询参数的只读链接，用户逐页继续，最多五页。每页结果须核对选中后保存。

当前 AI 覆盖数据类型：已登记卡片的金额、积分计划、优惠、交易、福利已用金额。新卡自动发现、无限滚动、PDF/图片、跨域积分站及无人值守全站采集尚未实现。七家银行共享验证协议，但各银行各类数据尚未完成真实模型验收，不等于已支持所有网页布局。

验证记录见 outputs 的本轮审计报告。

## 统一银行刷新（本机调试）

常用流程只有“刷新银行／刷新全部银行”。所有数据类别共享同一任务、登录引导、取消和结果进度。内部先执行规则读取，再在已开启本机解析服务时补全积分、福利、优惠与交易。银行只读链接可自动遍历，最多五页；未读到不等于已确认不存在。

运行 `npm run dev:wallet`，服务绑定 127.0.0.1:8766，静态页面取自 dist，DeepSeek 配置从工作区 .env.local 读取，绝不打包到扩展。GET /api/parser/status 不返回密钥。POST /api/parser/parse 限定已知扩展与本地网页来源、JSON、固定模型目标、固定提示词、请求体大小、并发1和24秒超时。当前使用云端模型，并非本地推理。

在独立钱包“设置”点击连接本机服务，批准可选 loopback 权限，并明确开启 DeepSeek 财务片段解析。仅在用户允许后自动刷新解析。旧 AI 助手不再是主导航入口；模型配置是刷新设置。
