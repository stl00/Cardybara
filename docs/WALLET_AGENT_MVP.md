# 钱包体验与 Agent MVP · 2026-10-28（America/Chicago）

本轮仅本地钱包，不向旧私有站部署。福利公共资料从独立工程页面融入卡片提示、卡片详情、总览及「本期福利」。完整卡库/福利参考仍在设置入口，数据与旧代码保留。

## 架构选择

先采用受约束的单步路由：自然语言 → 一个JSON意图 → 本地白名单工具 → 确定性结果与来源。复用已配置DeepSeek Flash兼容API，模型只读用户主动提交的一句话；不上传钱包、卡片清单、余额、网页或个人标记。未勾选AI也可用本地解析和结构化选项。没有引入LangChain，没有声称自由规划或多Agent自主执行。未来换OpenAI SDK只需替换意图provider，规则工具与账本独立保留。

官方参考：
- https://developers.openai.com/api/docs/guides/function-calling
- https://api-docs.deepseek.com/guides/json_mode/

MVP路由：recommend（比较用卡）、benefits（查询持卡福利）、credits（打开个人清单）、unsupported（说明范围）。服务端/客户端分别校验枚举、金额、长度和空值。缺少类别、地区、币种或金额需补充。模型不能返回执行脚本、URL工具、自动记已用、转账或登记优惠。

## 比较规则及边界

src/spendAdvisor.js按产品身份绑定已核对的earning-rule ID，从公共知识取数字、修订和来源。不按聊天模型猜倍率。CSR、Freedom、Gold、BCE、Aspire、Atmos餐饮、BOA Customized、加拿大白金、香港白金/Explorer及普通渣打Cathay已有部分场景适配；未适配的卡/场景明确不参加比较，不能把它们当成零回报，也不能声称全22卡所有场景已经最优。

现金只与同币种现金比较；MR、UR、Asia Miles独立显示，不用4MR>3UR这种原始数字强排。没有私设积分估值，没有将公共Credit面值加入收益。未知分类额度保持有条件；大于已知分类上限但无法计算完整分段时不显示虚假的全额加速回报。跨地区/币种、商户分类、收卡、外币费、迎新加成和登记未知不擅自补全。直订/渠道条件未确认只显示条件候选。用户须核对商户实际类别与支付方式。

BOA Customized其他消费1%与季度加成上限无关：2026-10-28重核官方产品页后新增revision2，保留revision1。知识快照更新2026-10-28.1（266修订/264独立知识ID）。Morgan Stanley Uber按月15美元、12月35美元的周期另建修订，保留旧年度摘要。

## 个人记录与数据可靠性

公共知识（带版本JSON）与个人记录（IndexedDB cardybara-personal v1）分开。个人benefit-events为append-only事件日志，事务提交成功才更新UI，唯一eventId防重复；每次变更保留时间和rule revision。按卡片ID、规则ID及起止日期构成周期主键。默认unknown不是unused；user可点used、unused、skipped或撤销为unknown。月份/半年/季度/年度分别计算；新周期不继承旧状态，规则修订变化重新确认。未知周年周期和账户版本不自动建可用清单。

单次写入在事务内取得递增时间，快速撤销不因同毫秒排序失效；旧备份按事件时间回放，不覆盖更新的标记。重复导入幂等，冲突eventId或不合法批次整笔拒绝。多标签页通过BroadcastChannel与写后重读同步。读取/写入失败给错误，不显示假成功。财务快照/银行存储并未整体迁到IndexedDB，本轮只迁入新增的个人福利层；不称整个平台已具备生产级云同步或灾备。

钱包导出增加personalBenefits:{schema:1,events}，导入兼容不含该字段的旧备份。凭据与AI问句不保存在这个账本。浏览器清理/卸载扩展可能清除本地数据，备份需要用户保留；网页与扩展是不同origin，用导入导出迁移。旧银行采集器不因本轮前端更新而重启或标验收成功。

## 提醒

打开钱包时显示三天内截止且待确认/未用的条目。可导出当前周期ICS，带09:00本地日历事件及VALARM；若本期原提醒时刻已过，改为导出后约10分钟；需要用户导入系统日历。只导出本期未处理条目，之后在钱包改标记不会自动同步已导出的日历，下一周期需重新生成。不声称已开通钱包关闭后的后台推送或未来永久自动提醒。本轮没有新增Chrome通知权限或创建Codex周期任务。

## 服务与测试

/api/advisor/intent沿用loopback Host/Origin白名单、客户端Header、请求体上限、单并发和24秒超时。只接受question字段，携带wallet等字段返回400；外来Origin返回403；只向固定DeepSeek地址发出请求，密钥保留.env.local，不进前端/安装包/日志。

161项测试通过：含账本真实IndexedDB语义模拟、事务/冲突导入、快速撤销、跨期隔离、修订隔离、提醒过滤、不同奖励币种不混排、分类额度未知、模型参数与目的地校验。DeepSeek真实接口使用模拟问题「在美国餐厅花100美元，用哪张卡」返回正确意图，未发送钱包。浏览器验收建议来源、卡片福利集成及标记/撤销持久化；最终结果与截图见任务outputs/wallet-agent-mvp-2026-10-28.json。


## Conversational agent upgrade · 2026-10-28

The advisor is now an AI-required chat experience. The optional AI switch and manual comparison form have been removed from this page. A session holds complete user/assistant/tool turns in memory (not browser storage); refresh or New Chat starts over. Navigation within the page session retains completed turns.

DeepSeek Flash uses native function calling, not the earlier JSON intent router. The model can choose `list_cards`, `compare_cards`, `find_benefits` and `list_credits`, request multiple read-only tools, receive results, and synthesize its answer or ask clarification. Calls execute locally against the existing rules and ledger. No bank navigation, payments, enrollment or ledger writes are available to the agent. The old intent endpoint remains for compatibility, but the chat does not call it.

The loop permits four tool rounds (up to four calls per round), then forces a final answer; requests have timeouts and cancellation, and history has a bounded size. Aborted/failed turns are not committed to history, so retry cannot leave orphaned tool results. The proxy accepts only allowlisted roles, validates tool names, arguments and message sequences, and has the same loopback origin/header/concurrency restrictions as the parser. Model output is Markdown with raw HTML and images disabled.

Privacy: chat text plus necessary public card names, earning rules, sources and user-marked credit states reach the previously authorized DeepSeek service. Bank balances, card numbers, credentials and raw wallet snapshots are not available to these tools. Keys remain in `.env.local`. The chat UI explains this before the first send. Public rule eligibility does not assert enrollment or remaining benefits; unknown manual status must remain unknown. Search returns at most 12 benefit records and explicitly labels partial coverage. Recommendation coverage limits remain unchanged.

Verification: four added tests exercise argument/privacy boundaries, malicious/orphan message rejection, multiple calls and follow-up history, cancellation and finite loops, and model destination/output constraints. Browser smoke tests confirmed live DeepSeek tool use for a US USD100 restaurant question and a follow-up switching to Canada/CAD100. Full regression suite: 165 passing. No bank collection or hosted release is claimed.
