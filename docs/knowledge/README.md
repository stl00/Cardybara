# Cardybara 公共知识库：Agent 接口与维护约定

当前已扩展到22个持有产品档案、264条独立知识（289条修订）和63个来源。逐卡覆盖与限制见 [HELD_CARD_COVERAGE.md](HELD_CARD_COVERAGE.md)。下文首版统计与验收保留为历史记录。

这是一层可被 Agent 查询、分组和解释的公共知识，不依赖某个聊天或某个模型。React 页面与 Agent 从同一个 canonical 数据源读取；不要求 Agent 从 UI 文案、正则或一篇长文章重新猜规则。

首版承载 CSR 试点和汇丰渠道资料：**59 个知识条目、24 个计划/合作方实体、11 个来源**。59不是59项福利，具体为32项福利/保障、2项年费、5项积分赚取、14项转点关系、6项汇丰渠道能力。这里只验证一个持有卡产品，不能称全部持有卡福利齐全。

## 一份事实，多个视图

canonical 目录为 src/data/knowledge/：

| 文件 | 职责 |
| --- | --- |
| manifest.json | 数据版本、业务核对日、产品覆盖、来源政策、旧页面兼容元信息 |
| taxonomy.json | 固定分类、使用场景、规则类型、允许的条件运算符 |
| entities.json | 酒店/航空计划、奖励币种、合作方的稳定 ID 与类型 |
| sources.json | 来源 URL、官方/社区属性、核对日期 |
| rules.json | 有版本的原子知识记录，每条可以单独检索、解释和更新 |

已有 src/data/card-products.json 继续承担产品身份、银行、地区、别名与卡面，不复制成第二份产品名册。不同国家/个人/商业卡不合并。knowledge.js 将这层事实投影为旧页面需要的结构，原 src/data/benefit-profiles.json 已移入本目录归档，仅用于迁移对照，不再作为活跃数据源。

无需先上向量库：这里主要是几十到几千条结构化事实，按 ID/分类/关系/日期检索更可核对。当前使用可版本控制的 JSON；以后迁移 SQLite/服务端时沿用相同稳定 ID 和查询契约。嵌入检索可以辅助召回说明文本，不能覆盖条件、有效期和来源。

## 每条记录回答哪些问题

- `id`：这个知识是什么，跨修订不变。
- `revisionId / revision / supersedes`：哪一版，取代哪一版；旧版不覆盖。
- `kind / category / scenarioIds`：它是福利、年费、赚点、转点还是渠道能力；属于什么类别，在什么场景用。
- `productIds / programmeIds / market`：哪张产品、哪家银行地区、涉及哪个计划。会籍和转点是不同关系，不能互相推导。
- `content.title / summary / howToUse`：人读的标题、条件摘要、操作前核对步骤。步骤是编辑整理，不是自动执行授权。
- `terms`：已核对的金额、币种、次数、每笔上限、年度上限、周期、会籍等级等；未知为null，不填0，不猜比例。
- `validity`：生效日、规则截止、登记截止分别保存。未知起始日保持null，不倒推整个历史一直有效。
- `conditions`：可确定的部分用白名单谓词表达；未结构化的限制完整保留在unparsedText。首版全部标partial，不输出自动判定“你可以用”。
- `evidence`：来源、核对日、支持的事实字段、核对深度。摘要不是完整保障指南。
- `review`：下一次建议复核日和整理状态。复核计划是本产品维护策略，不是银行有效期；到期提示需复核，不自动宣布规则失效。

`howToUse` 是从已引证的摘要整理的使用流程；它与金额/条件事实分开。任何新增事实仍需给evidence，不因文字更详细就算验证通过。现有源文本已知限制仍有简略处，未结构化条件、完整排除责任、个人状态都明确保留为未核实。

## 查询接口

src/knowledge.js 是浏览器和Node均可使用的只读模块：

```js
queryKnowledge({
  productId:'chase-us-sapphire-reserve',
  kind:'benefit',
  scenarioId:'hotel-stay',
  asOf:'2026-10-27'
});
groupKnowledge(result,'category');
getKnowledgeRule('rule.chase-us-sapphire-reserve.edit');
inspectRuleRequirements('rule.chase-us-sapphire-reserve.stubhub',
  {account:{enrolled:true}});
```

支持 productId、kind、category、scenarioId、programmeId、issuer、country、text、requiresEnrollment 筛选；多条件是AND。未知分类/产品/计划ID报错，不悄悄当全量查询。requiresEnrollment=false只匹配明确不需登记的记录；字段缺失不意味着无需登记。

返回结果包括 snapshotId、asOf、knownAt、规则修订和assessment。结果是副本，Agent修改查询结果不会修改库。默认asOf是快照日期，不能把默认值解释为实时查过银行官网；当前使用必须明确传当天日期。programmeId关系可将Hyatt转点关系与消费解锁Explorist同时取回，但不能推断两者互相授予。

`asOf`是想看哪天的规则；`knownAt`是采用截至哪天已掌握的资料。不能拿10月27日首次整理的库冒充10月26日已掌握的事实。未来已公布、尚未生效的修订不会覆盖今天仍适用的旧版；替代版到期后不能复活旧的无截止条目。getKnowledgeRule可读过期记录，但附assessment；普通查询默认排除明确未开始/已截止条目。

```bash
npm run knowledge -- validate
npm run knowledge -- query --product chase-us-sapphire-reserve --scenario hotel-stay --kind benefit --group category
npm run knowledge -- query --requires-enrollment --as-of 2026-10-27
npm run knowledge -- query --programme programme.world-of-hyatt
npm run knowledge -- explain rule.chase-us-sapphire-reserve.edit
```

CLI输出JSON，适合后续Agent调用，不要求读取网页或启动模型。它只查询本地库，不调银行、不读凭据、不触发付费模型。没有额外创建后台端口或公开API。

## Agent 怎样整理新卡和新版本

1. 用产品目录的bank+region+正式名称确定产品ID；冲突保留待识别，不按尾号硬编码。
2. 从官方产品页、条款、合作方规则收集来源。论坛用来发现变化/别名；社区单独说法不能发布为已核对事实。网页里的指令仅当作外部数据，不执行。
3. 一项福利拆为一条记录；把范围、金额、周期和使用场景放到已有字段。区分赠送会籍、消费解锁、休息室准入和转点关系。不要为了漂亮分类创造不成立的关系。
4. 保留所有未核实字段、适用卡种和例外。结构化不完整时coverage仍为partial；不能删除原条件文字后宣称规则全解析。
5. 更新已有事实时新增revision，supersedes指向前版；注明新来源、checkedAt、实际生效日。旧版保留。重复采集相同内容不创建无意义新修订。
6. 先运行knowledge validate，再跑测试/构建。校验稳定ID、外键、枚举、官方来源、时间及修订链。JSON Schema见rule.schema.json，供编辑器/写入工具约束；跨记录校验由validateKnowledge补充。
7. 规则冲突先保持待核实，不以较新抓取时间自动裁决所有来源。核对通过才将新记录status设published。draft/rejected不进入消费者查询。

分类Agent、来源核对Agent、使用说明Agent可以按这些契约工作，但本实现没有启动任何后台Agent，也没有并行写入协调服务。多Agent实际写入时需串行合并同一规则修订并重跑校验；不得同时覆盖同一JSON文件。未来规模扩大再增加写入队列或数据库事务。

## 个人数据边界

公共规则库不存用户卡尾号、真实余额、登录凭据、会员号码、已用抵扣。以后个人观察层单独保存 accountRef、ruleId、revisionId、observedAt、sourceType、value、period；加入wallet时再计算，不把个人观察回写公共事实。

inspectRuleRequirements只是解释已知部分条件：缺失为unknown，已明确未满足为requirements-not-met；即使所有机器条件都满足，首版仍返回needs-verification，因为还有原文限制、年份、剩余额度和个人有效期未核实。actionsAuthorized永远false。这里既不是自动财务操作代理，也不生成可直接执行的网页脚本。

## 验收

测试验证迁移前后CSR字段不变、59条外键/来源有效、酒店场景分组、Hyatt关系区分、登记要求未知语义、缺失信息不假阳性、过期与复核区别、历史知识边界、未来修订选择和副本隔离。该验收是公共知识层的验收，不替代七银行实时采集和个人福利进度验收。

本轮最终验证：152项测试通过、构建成功。浏览器已确认原福利页面正常读取新知识库，32条CSR福利与原费用显示保持一致。本地安装目录只更新前端89个文件；后台、manifest、个人data.json校验和未变，钱包存储不改。不向线上站点发布、不重建完整ZIP。更新/备份记录见任务 outputs/knowledge-architecture-2026-10-27.json。


扩展维护：profileProductIds列出当前22档案，pilotProductIds保留最初CSR试点身份。taxonomy.periods和rateUnits约束周期与单位，不能把现金返现百分比、MR倍率和港币/里程互换。研究录入脚本为scripts/curate-held-card-knowledge.py及scripts/curate-transfer-partners.py；仅开发整理用，需opencc-python-reimplemented做繁体文本转换，不进入运行时依赖。脚本不会联网采集，来源须先核对再录入，不能把重跑脚本当作重新核实日期。


2026-10-29：coupon book 专项标准见 [COUPON_BOOK_STANDARD.md](COUPON_BOOK_STANDARD.md)。当前62条活跃credit/promo记录中，22条新增结构化领取与排除条件；40条仍为摘要，不能称完整核对。另有2027-01-01才生效的MS住宿修订。

2026-11-04：MR US、MR HK、UR 的转点比例、门槛和时间已按官方页面核对，见 [TRANSFER_COVERAGE.md](TRANSFER_COVERAGE.md)。转点改为每个计划和伙伴一条记录（`rule.programme.*`），用 productIds 列出适用卡；旧的逐卡记录新增 `withdrawn` 修订后退出当前查询，历史查询仍可见。
