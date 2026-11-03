# Cardybara 1.1.0 工程预览与发布门槛

当前阶段：本地工程预览，已获准安装独立 1.1.0 开发版；未发布网站新版、未提交商店。
现有 1.0.0 扩展目录及其 Chrome 安装保持原状。水豚原稿和 01×03
融合版已保留，见 brand-archive/2026-10-23-original-concepts。

## 本轮完成

- 集中 issuer/region/locale/currency/host registry；Amex US/HK/CA 分开。
- schema-2 持久状态、串行 run、attempt/generation、documentId 注入与晚结果拒绝。
- 导航/关闭/取消/超时/重启状态；重启明确中断、不自动重做银行导航；无 keepalive。
- 每字段保留 value/currency/source/capturedAt/locale/adapterVersion/status。
- 私人 origin、顶层 sender、请求键/长度/数量/银行/卡片/币种严格校验。
- 零值与未知区分，歧义拒绝，跨币种拒绝，失败保留旧数值和日期。
- Popup 取消、按银行启停与清除、导出；旧 Dashboard 数据兼容与来源日期保留。
- 默认蓝白 UI 中加入真实覆盖表，新旧扩展协议分开，不把快照同步当银行采集。
- 源码参考记录与完整 MIT 许可；未复制 Nextcard 后端、凭证或商标。
- 固定 ZIP 元数据、文件白名单、版本/图标/权限/脚本检查、包内 SHA256、
  从实际 ZIP 提取并导入 worker 的 mock-Chrome 测试。

## 实际覆盖矩阵

| 银行 / 地区 | 语言框架 | 金额字段 | 实测证据 | 积分 / Offers / 福利 / 交易 / 到期日 |
|---|---|---|---|---|
| Chase US | en-US | balance / available / statement / minimum | 部分真实字段曾读取成功；后续单卡刷新超时，稳定性未通过 | 未支持 |
| HSBC HK | zh-HK / zh-CN / en-HK | 余额反号处理；available/minimum 框架；statement 禁用 | 繁简英合成样例通过；实际 DOM 待验收；HKD/CNY 未明确分区则跳过 | 未支持 |
| Amex US | en-US | 框架 | 未验证；generic global 地区不明确时拒绝 | 未支持 |
| Amex HK | zh-HK / zh-CN / en-HK | 框架 | 未验证 | 未支持 |
| Amex CA | en-CA / fr-CA | 框架；法语金额样例 | 未验证实际页面 | 未支持 |
| BOA US | en-US | 框架 | 未验证 1.1.0 | 未支持 |
| SC HK | zh-HK / zh-CN / en-HK | 框架 | 旧版上一轮需登录；1.1.0 未验证 | 未支持 |
| UK、其他加拿大银行 | 未实现 | 未实现 | 计划，缺少实际账户/页面证据 | 未支持 |

同一银行多会话标签页不猜选，返回加载失败。已知尾号冲突拒绝；未登记账户
与同尾号的跨会话身份绑定尚待完善。当前仍需在真实页面上完成专用账户容器
选择和逐卡导航；不能将安全的通用标签解析框架称为完整银行 adapter。
积分须按 programme/地区/账户建立独立 schema，不能直接加入金额合计。
Offers 未实现，不执行全量覆盖或删除，也不会自动激活任何优惠。

## 本地验证与可复现打包

```
node --test tests/collector.test.mjs tests/live.test.mjs
python3 scripts/package-extension.py /absolute/path/to/node
npm run build
```

Python/Node 标准库打包，使用提交的图标，无新 npm 依赖。原始图标来自
本地水豚 SVG，尺寸 16/32/48/128；公开资源与银行读数不混在扩展包内。
ZIP 只含 22 个白名单文件与校验清单。两次构建 SHA256 应一致。
mock 测试不等于真正安装 Chrome，更不等于真实银行采集通过。

## 发布前仍须通过（不可省略）

1. 用户审核具体包及新增 storage/alarms 权限后安装。仅本地开发时，可用单独
   development 包授权 127.0.0.1 页面，桥接严格限制到 :8766；生产包绝不带本机域名。
2. 真正 Chrome：安装 ZIP、任务中终止 worker、关闭/重开 Chrome、Dashboard
   重载、页面跳转/关闭、取消后晚消息、重复点击、持久化失败后的表现。
3. 在实际账户验证 Chase 样板和至少一个非美银行专用 adapter，检查每卡身份、
   多币子账户、语言、MFA、账单符号、字段日期；没有页面证据不扩大覆盖声明。
4. 完成页面级专用 adapters 与逐卡导航，扩展积分/福利/Offers schema，
   脱敏 fixture 和完整/部分快照语义；缺失字段不能标“已支持”。
5. 生产私有 Dashboard 1.1.0 协议联调需要单独选定发布时机；用户当前要求先本地。
6. 商店正式隐私政策维护方/联系渠道/URL、截图、描述和权限用途，商店审核材料。
   本地 privacy.html 是预览说明，不是虚构已存在的公开隐私政策。
7. 真正升级和回滚演练。未知 storage schema fail closed；v1 数据不删除、不换日期。

## 数据与回滚

既有 atlas-bank-live-v1、导入/收藏键不变，v2 使用独立扩展 key。
读数保存在当前 Chrome profile；不使用 sync、遥测或第三方上传。
Dashboard 本地合并副本与扩展副本分开清除；发布历史快照仍是独立基础记录。
按银行停用不会退出银行或撤销 Chrome host permission。需要撤销时到
chrome://extensions 详情操作。卸载扩展不清除网站 localStorage。
导出 v2 JSON 与旧全钱包导入格式不同，暂不提供互导迁移。
回滚前导出，停用预览版、启用保留的 1.0.0；不要覆盖旧目录。
每日 09:00 本机任务与扩展手动刷新是不同机制，扩展 alarms 仅作超时收尾。

## 设计参考与官方契约

- https://github.com/affil-ai/nextcard-sync/tree/d39ebb08c4c408a99046087f24e9ccf511e61898
- https://developer.chrome.com/docs/extensions/reference/api/scripting
- https://developer.chrome.com/docs/extensions/reference/api/alarms
- https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle

没有对参考项目做全仓安全审计，也未安装 Nextcard。
