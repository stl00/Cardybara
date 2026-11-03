# 福利资料试点 · 2026-10-27

本地 Cardybara 新增「福利资料试点」入口（/#guide）。先验证用户持有的美国个人 Chase Sapphire Reserve：32 项福利/保障条目、14 个官方转点伙伴；其他21张持有卡仍标待整理，不按同银行或相似名称套用规则。保留 Ant Design 原生主题，简体、繁体、英文。原有完整采集功能保留，MVP采集仍只含积分和余额/账单/还款日。

## 数据与来源

维护 src/data/benefit-profiles.json。每项保留 checkedAt、sourceIds、周期、生效/截止/登记截止、激活条件、消费门槛、partner/tier。公开产品条件不包含个人尾号、余额、剩余抵扣或已登记标记。美卡论坛可发现产品/变化；本试点论坛链接仅作研究线索，展示的福利事实均有官方来源。没有复制论坛或官方文章全文，也不把页面摘要称为完整保险条款。

- https://creditcards.chase.com/rewards-credit-cards/sapphire/reserve
- https://www.chase.com/personal/credit-cards/offerdetails/chasesapphire
- https://www.chase.com/sapphire-cards/personal/reserve
- https://help.doordash.com/en-us/consumers/article/chase-partnership?chasewebview=false
- https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points
- https://www.uscardforum.com/t/topic/403416 （社区线索，非最终条款）

本次发现不能把福利当成永不变的静态字段：2026-10-01 DoorDash 通用优惠发生变化；The Edit 2026年起按自然年500美元、每笔最多250，不能继续套用旧半年规则。资料保存核对日期与变更提示，个人领取和活动状态仍以账户为准。

## 规则与个人状态

src/benefitRules.js 按 bank+region+产品精确匹配，个人CSR不能套用商业版。月/半年/自然年可计算；账户周年和四年滚动周期需账户日期，不猜起止。登记截止不等于已登记会员的到期日。75000美元消费解锁条件单独列出，不因持卡自动授予。未来若接入个人消费记录，须补充已达标年份及次年有效性，不按每年重新消费误判已授予状态。

32项包含9项保障摘要，未逐项验证所有保额/除外责任，界面明确要求核对理赔条款。14个转点伙伴仅表示可转点；兑换比例、个人关联账号均待核实，不能据此声称赠送航空或酒店会籍。会员权益、休息室资格和转点关系分别展示。

所有公开规则默认 accountState=unverified。页面从不将公开额度当作剩余额度，也不将所有券面额相加作为实际收益。可选个人进度匹配要求明确银行名称、相同周期截止、同币种、有效且不晚于当前日的采集时间；缺失保持未知，不填0。个人进度尚未全面采集验收。

## 汇丰 RewardCash 网页能力

官方条款2026-10-12生效；本次核对2026-10-27：

- 普通信用卡奖赏钱有账单/网银信息渠道，具体账户页面字段需登录验证；官网有里数兑换入口。
- EveryMile/Privé 商品或里数兑换须用Reward+，不能通过网银。
- Standalone RewardCash账户的信息查看及兑换均仅限Reward+。
- Pay with RC、活动登记记录属Reward+功能，不能保证网页版完整覆盖。
- EveryMile不能接收其他卡转入，也不能作合并结算卡；普通RC/EveryMile RC/独立RC账户分别建模。

来源 https://www.hsbc.com.hk/credit-cards/rewards/terms/ 、 https://www.hsbc.com.hk/credit-cards/rewards/mileage-programme/redeem/ 、 https://www.hsbc.com.hk/credit-cards/rewards/app/ 。本轮浏览器没有可用的汇丰银行标签页，未声称个人奖赏钱已刷新。历史 outputs/hsbc-hk-normalized-2026-10-26.json 有7条RewardCash网页读数，walletWritten=false，仅能证明历史页面出现过字段，不能作本次写回验收。

## 验证与发布范围

142项测试通过，包含6项福利规则测试；生产构建通过。浏览器验证CSR额度/周期、14伙伴及汇丰能力表，截图 outputs/csr-benefit-pilot-2026-10-27.png。本次仅更新本地前端，不部署到原网站；扩展后端不变，用户存储、data.json、manifest不变。安装目录更新及归档记录见 outputs/benefit-pilot-ui-update-2026-10-27.json。未重新打包完整扩展ZIP，原下载包不是本次前端版本。

下一步以同样结构逐卡整理现有持卡：优先实际有会员/旅行抵扣的卡，逐条记录官方来源、周期、需登记/需达标限制。此公共知识层与七银行MVP采集验收分别推进；不能将资料库产品数量当作银行实时读取成功数量。
