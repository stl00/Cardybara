# 转点数据核对（MR US / MR HK / UR）

核对日期 2026-11-04，只读公开页面，未登录。比例、门槛和时间照发卡行原样记录，页面没写的留空（—）。转点奖励活动不在范围内。Amex CA 已归档，未核对。

## 口径

- **MR US**：页面列出的 20 个伙伴全部有比例、最低数量、增量、上限和预计时间。页面只写“转入美国航司计划”收消费税抵销费，这里按 Delta、JetBlue 记录，属于据此判断。
- **MR HK**：只公开 Turbo 计划费率，未登记 Turbo 的费率须登录查看，未记录。页面同时写了 999,000 和 9,999,000 两个单笔上限，无法判断，上限留空。Emirates Skywards 页面写明暂停，不收录。Enrich、KrisFlyer、British Airways 的单位带星号但页面没有脚注。
- **UR 比例**：Sapphire Preferred 页面只说“多数伙伴 1:1”，没有逐项列明；Ink Business Preferred 页面让用户登录查看。因此 13 个伙伴的比例留空，不计算里程。旧新闻稿中的 1:1 属于过去的声明，不当作当前比例。
- **World of Hyatt**：Sapphire Preferred 和 Ink Business Preferred 页面写明 2026-10-01 起 4:3。Sapphire Reserve 的页面没有写，比例留空，不套用其他卡。
- **UR 费用和门槛**：协议写明可能收取转点费，并会在转点前告知，所以费用记为“可能收取”，不是没有。最低数量未写，只写了 1,000 点增量。
- **Sapphire Reserve for Business**：产品页只写“1:1 转到主要酒店和航空计划”，没有列出伙伴，Chase 指南也没有提到这张卡，所以暂不关联伙伴。

转点通常不可撤销：两家官方都写明转点后不能退回。伙伴关系不代表已关联账号，也不授予精英会籍。

比例记录在 `transferRate`，`terms.ratio` 保持为空：assistant 目前分不清每张卡的比例，要等 #72 的确定性工具接入后才使用这些比例。

## 明细

| 计划 | 伙伴 | 比例（点→单位） | 最低 | 增量 | 单笔上限 | 预计时间 | 费用 | 来源 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| MR US | Aer Lingus AerClub | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Aeromexico Rewards | 1,000 → 1,600 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Air Canada Aeroplan | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Air France KLM Flying Blue | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | ANA Mileage Club | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 4 days | — | https://global.americanexpress.com/rewards/transfer |
| MR US | avianca lifemiles | 1,000 → 1,000 | 1,000 | 1,000 | 750,000 | estimated 72 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Cathay Asia Miles | 1,000 → 800 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Choice Privileges | 1,000 → 1,000 | 1,000 | 1,000 | 9,999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Delta SkyMiles | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | excise-tax-offset | https://global.americanexpress.com/rewards/transfer |
| MR US | Emirates Skywards | 1,000 → 800 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Hilton Honors | 1,000 → 2,000 | 1,000 | 1,000 | 3,000,000 | estimated 24 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Iberia Club | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | JetBlue TrueBlue | 250 → 200 | 250 | 250 | 999,750 | estimated 48 hours | excise-tax-offset | https://global.americanexpress.com/rewards/transfer |
| MR US | Marriott Bonvoy | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Qantas Frequent Flyer | 500 → 500 | 500 | 500 | 999,500 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Qatar Airways Privilege Club | 1,000 → 1,000 | 1,000 | 1,000 | 750,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Singapore Airlines KrisFlyer | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | The British Airways Club | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | The Leading Hotels of the World Leaders Club | 1,000 → 250 | 1,000 | 1,000 | 999,000 | estimated 72 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR US | Virgin Atlantic Flying Club | 1,000 → 1,000 | 1,000 | 1,000 | 999,000 | estimated 48 hours | — | https://global.americanexpress.com/rewards/transfer |
| MR HK | Cathay Asia Miles | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | estimated 48 hours | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | Malaysia Airlines Enrich | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | up-to 10 days | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | EVA Infinity MileageLands | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | up-to 10 days | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | Qantas Frequent Flyer | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | estimated 48 hours | administration | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | Singapore KrisFlyer | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | up-to 15 days | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | The British Airways Club | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | estimated 48 hours | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | Virgin Atlantic Flying Club | 18,000 → 1,000 (Turbo) | 18,000 | 9,000 | — | estimated 48 hours | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | ALL Accor | 25 → 1 (Turbo) | 25,000 | 12,500 | — | estimated 48 hours | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | Hilton Honors | 64 → 10 (Turbo) | 8,000 | 8,000 | — | estimated 48 hours | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| MR HK | Marriott Bonvoy | 9 → 1 (Turbo) | 9,000 | 9,000 | — | estimated 48 hours | — | https://www.americanexpress.com/en-hk/rewards/membership-rewards/travel/all |
| UR | Aer Lingus AerClub | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | The British Airways Club | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Air France KLM Flying Blue | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Iberia Club | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | JetBlue TrueBlue | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Singapore Airlines KrisFlyer | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Southwest Rapid Rewards | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | United MileagePlus | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Virgin Atlantic Flying Club | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Air Canada Aeroplan | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | IHG One Rewards | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Marriott Bonvoy | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | Wyndham Rewards | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |
| UR | World of Hyatt (Sapphire Preferred / Ink Business Preferred) | 4 → 3 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/sapphire-cards/personal/preferred |
| UR | World of Hyatt (Sapphire Reserve) | 未逐项列明 | — | 1,000 | — | up-to 7 business-days | 可能收取 | https://www.chase.com/personal/credit-cards/education/basics/how-to-transfer-chase-ultimate-rewards-points |

## Bilt Rewards（2026-11-11，#231）

来源：Bilt 帮助中心转点伙伴文章（2026-10-20 更新），https://support.biltrewards.com/hc/en-us/articles/19086448638989-Bilt-s-Transfer-Partners 。最低转点数按会员等级不同：Blue 等级 2,000 点，Silver 及以上 1,000 点，都按 1,000 点递增；会员等级未知，所以最低数量不用于计算，只按增量算。多数即时到账，最长 48 小时，Southwest 最长 72 小时。页面没写费用和单笔上限，留空。Bilt 自己的页面写的伙伴数不一致（23、25、27、28），这里按帮助中心逐项列出的 27 个记录。Atmos Rewards 的实体类型从 partner 改为 airline。

| 伙伴 | 类型 | 比例（点→单位） | 最低 | 增量 | 预计时间 |
| --- | --- | --- | --- | --- | --- |
| Aer Lingus AerClub | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Air Canada Aeroplan | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Air France KLM Flying Blue | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| ALL Accor | hotel | 3 → 2 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Amtrak Guest Rewards | rail | 2 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Atmos Rewards | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| avianca lifemiles | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Cathay Asia Miles | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Emirates Skywards | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Etihad Guest | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Hilton Honors | hotel | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| I Prefer Hotel Rewards | hotel | 1 → 2 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Iberia Club | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| IHG One Rewards | hotel | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Japan Airlines Mileage Bank | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| JetBlue TrueBlue | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Marriott Bonvoy | hotel | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Qatar Airways Privilege Club | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Southwest Rapid Rewards | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 72 hours |
| TAP Miles&Go | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| The British Airways Club | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Turkish Airlines Miles&Smiles | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| United MileagePlus | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Virgin Atlantic Flying Club | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Virgin Red | airline | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| World of Hyatt | hotel | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |
| Wyndham Rewards | hotel | 1 → 1 | 2,000 / 1,000 | 1,000 | up to 48 hours |

## Citi ThankYou Points（2026-11-11，#181）

来源：Citi Strata Premier 和 Citi Strata Elite 的公开产品页（未登录），https://www.citi.com/credit-cards/citi-strata-premier-credit-card 和 https://www.citi.com/credit-cards/citi-strata-elite-credit-card 。两页写法相同：“Points transfer to American Airlines, JetBlue, Virgin Atlantic, Cathay, Eva Air, Choice Hotels, The Leading Hotels of the World® and others”，以及“The minimum transfer is only 1,000 points.”

**已核对**

- 7 个点名的伙伴，适用 Strata Premier 和 Strata Elite。
- 最低转点 1,000 点。

**仍未知（留空，不计算里程）**

- 每个伙伴的比例：两页都没有写，所以 `convert_points` 只列出伙伴，不换算。常见的 1:1 说法不是官方页面上的内容，不采用。
- 增量、单笔上限、到账时间、费用、是否可撤销：页面没有写。
- “and others” 指哪些伙伴：页面没有列，不收录。
- Strata Premier 和 Strata Elite 之间比例是否不同：页面没有区分。
- Citi Double Cash：产品页没有提到转点，不关联伙伴。Custom Cash 未核对，同样不关联。
- thankyou.com 的伙伴列表页未登录时没有返回内容，没有绕过；旧的转点条款页（含已停运的计划）不当作当前来源。

页面写的是航空公司和酒店集团的名字，不是会员计划名；这里按各公司自己的会员计划记录，属于据此判断。钱包不读取 ThankYou 余额（Citi 的积分不在 MVP 范围），所以奖励页不加 ThankYou 标签，只供 assistant 回答。

| 伙伴 | 类型 | 比例（点→单位） | 最低 | 增量 | 单笔上限 | 预计时间 | 费用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| American Airlines AAdvantage | airline | 未写 | 1,000 | — | — | — | — |
| JetBlue TrueBlue | airline | 未写 | 1,000 | — | — | — | — |
| Virgin Atlantic Flying Club | airline | 未写 | 1,000 | — | — | — | — |
| Cathay Asia Miles | airline | 未写 | 1,000 | — | — | — | — |
| EVA Infinity MileageLands | airline | 未写 | 1,000 | — | — | — | — |
| Choice Privileges | hotel | 未写 | 1,000 | — | — | — | — |
| The Leading Hotels of the World Leaders Club | hotel | 未写 | 1,000 | — | — | — | — |
