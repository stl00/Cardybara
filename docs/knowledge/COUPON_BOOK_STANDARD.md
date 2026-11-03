# Coupon book 编辑与验收标准

优先级来自用户：持续打磨福利数据库，尤其月、季、半年抵扣的适用性与清晰管理。外部返现平台、地图、换肤暂不抢占本项工作。

## 原子权益与公共/个人边界

一条规则表达一个独立重置/领取单位。公开条款、个人登记、已消费、待报销、已到账、个人估值是不同事实，不能互相代替。金额、频率和卡片身份相同也不能据此合并账户额度。

`terms.coupon` 是公开领取/使用机制，schema=1。它不存个人余额、卡尾号、会员号或登记/使用状态。既有 terms.amount、quantity、period 继续是额度和周期的唯一主数据；coupon.redemption 只解释领取单位，校验时须与主额度一致。

| 字段 | 约定 |
|---|---|
| delivery | statement-credit 账单报销、wallet-credit 平台赠额、checkout-discount 结账优惠；三者不混算 |
| capScope | card-account / primary-cardmember / person / unknown；附属卡可触发不等于额外发一份 |
| enrollment | required / link-card / not-required / unknown；缺字段不能变成无需登记 |
| eligibleCountries / Merchants / Channels | 已有官方依据的范围；空数组表示本批未明确，不表示全世界/全部商户 |
| excludedPurchases | 已明确排除的交易；不能通过相似品牌名称解除排除 |
| conditionalPurchases | 边界、收单与版本要求；不能拿社区成功经验变成必报规则 |
| redemption | 累计报销、单券、多券；每券金额、张数、分单、余值作废；禁止仅以总额相减推算剩余券数 |
| carryover | true/false/null；未明示时保留null，不凭月度总额反推结转 |
| posting | 官方等待窗口、归期依据、明确的截止时区；等待窗口不是到账保证，未知时区不拿Chicago默认填充 |
| additionalCards | 能否触发/是否共享分别记录，未知保持null |
| minimumNights | 全渠道统一的已核实最低晚数；不同渠道门槛不同则null并保留渠道条件，不能取其中最大值套全部 |
| review | 核对日、具体来源和章节、直接页面/官方索引/混合访问、未核实项；每项都允许保留缺口 |

conditions.coverage 继续为 partial，整条规则的 fullTermsReviewed 仍为 false：本次核对指定coupon字段，不意味着所有保险、账户条款和个人适用资格均已核实。record.reviewAfter 是内部复核任务，不是银行权益失效日。

## 修订规则

- 只追加修订，不覆盖旧版；evidence.checkedAt 是实际阅读日期，不当作权益生效日。
- 未来已公布的政策单列 effectiveFrom；今天的查询不能提前选中未来版。
- 同日不一致官方材料留冲突说明。官方端点403时，只使用可读官方索引并明示访问层级，不假装读过完整页面；本次找到MS官方印刷版后才扩展其细节。
- 当前来源只支持当前名单时，不补造某商户确切离开日期；过去查询保持旧版知识。
- 新修订可能令既有个人标记进入“待确认”；历史事件本身不删除或迁移到新周期，不为保住绿色状态而自动确认。

## 本轮范围 · 2026-10-29

22项现有权益新增结构化修订，另有一条2027-01-01生效的MS住宿修订：

- 美国Gold：Dining、Resy、Dunkin、Uber Cash。
- Aspire：Flight、Hilton Resort。
- CSR：DoorDash通用、DoorDash非餐饮、The Edit、指定餐饮、StubHub、Peloton。
- MS Platinum：Airline Fee、Digital Entertainment、Lodging、lululemon、Oura、Resy、Uber Cash、Uber One、Walmart+、CLEAR+。

当前活跃 credit/promo 分类记录62条，其中22条具本轮结构化领取条件，40条仍仅摘要。分类记录包含非定期、非现金优惠，这不是62张券，也不是完整22产品权益覆盖率。MS Equinox与条件解锁的Airbnb Experiences等官方页面新增范围尚未发布到本轮现有规则，必须保留“资料库可能有遗漏”的覆盖说明。

主要来源（具体字段来源与章节另见各规则coupon.review）：

- [Amex Gold 会员指南](https://www.americanexpress.com/en-us/account/get-started/gold/explore-benefits?searchresult=uber+eats+benefit)
- [Uber Amex 说明](https://www.uber.com/us/en/u/amex/)
- [Aspire Flight 官方权益条款](https://global.americanexpress.com/card-benefits/detail/flight-credit/hilton-aspire)
- [Aspire Resort 官方条款](https://global.americanexpress.com/card-benefits/terms/hilton-aspire)
- [Chase 个人 Sapphire 详细条款](https://www.chase.com/personal/credit-cards/offerdetails/chasesapphire)
- [Peloton 合作方说明及FAQ](https://www.onepeloton.com/chase-sapphire-reserve)
- [MS Platinum 官方印刷版权益条款](https://www.americanexpress.com/us/credit-cards/card-application/apply/partner/print/personal-card/msb/morgan-stanley-platinum-card/ep-msb-mcs-58?print=false)
- [MS Platinum 产品页](https://apply.americanexpress.com/amex-morgan-stanley%20-credit-cards/?page_url=38)

## 自动与人工验收

`npm run check:coupons`：字段完整性、未知值、官方来源、单券张数×券额与公开额度一致、错误时区/日期、登记矛盾，以及历史/未来政策选择。

`npm run test:refresh` 含coupon回归；`npm run check:agent` 含自然语言检索与回答检查。真实模型用例单独记录，不把一次通过解释为整体正确率。

人工抽查必须回答：是什么形式？这期多少？哪天/哪个时区结束？怎样领取？可以在哪些商户/渠道使用？哪些明确不行？哪些还需确认？主副卡怎样共享？退款会怎样？多久可能到账？来源哪天读过？

个人管理下一步：券实例/逐张兑换账本；交易已发生但报销未到的状态；账户周年锚点；同账户主副卡共享关系。当前累计金额账本保留，不能据此声称已完成逐张券管理。

## 可重复整理

两个 curate-*-2026-10-29.py 脚本只复现固定日期的人工作业，不联网、不刷新核对日、不等同重新核实。可重复执行但不同同日结果会报错，避免静默覆盖修订。运行审计：

```sh
npm run check:coupons
node scripts/audit-coupons.mjs --as-of=2026-10-29 --out=/absolute/path/to/coupon-audit.json
```
