# 公共卡片资料库 · 第一版

2026-10-27，America/Chicago。公共产品与用户账户分开：产品记录不包含个人 cardId、尾号、金额、余额、采集记录或积分余额。首批 90 种产品覆盖现有七家银行地区组合：Chase 43、Amex HK 17、HSBC HK 9、BOA 7、Amex CA 5、Amex US 5、SC HK 4。82 个产品名称已对照发卡行当前列表；另 8 个继承条目待单独核对，不冒充验证通过。资料库覆盖不是银行采集覆盖。

数据源为发卡行公开列表及产品页，目录不复制评测正文、开户奖励、APR 或年费。每条保留 sourceUrl、checkedAt、verification；奖励计划仅有明确官方来源才补入 rewardPrograms/rewardSource，其他留待核对，不按银行或卡名推断。当前五项奖励计划关系核对。后续可用美卡指南发现卡种、别名，但最终事实按发卡行核对。

canonical 数据：src/data/card-products.json。人工核对的补充：src/data/card-product-overrides.json。可重复开发入口，在源码根目录运行：

1. python3 scripts/catalogue-source-intake.py（仅公开银行产品目录，输出 /tmp/cardybara-public-catalog-extract.json）。
2. python3 scripts/build-product-catalogue.py（组装、去重并应用字段来源补充；不含银行登录页）。

匹配 API 在 src/productCatalog.js：要求 bank 和 region，按产品名/明确别名精确归一；不依赖个人尾号或固定账户 ID。不同地区 Platinum、信用卡和签账卡、个人和商业卡分别保留。冲突返回 ambiguous，陌生产品返回 unknown，不猜金额或改账户数据。此 API 已用于卡面展示，银行账户动态发现和任务范围注册尚未接通，不宣称任何一百种卡均能同步。

## 卡面

75 条产品有本地图片；15 条保留缺图占位，避免借用错误版本。58 个本次新增下载为银行官方 PNG。metadata 保存图片来源，既有宣传图使用明确 crop 配置集中渲染，不再依赖文件名特殊判断。所有原图保留，无像素生成或重绘。

CSR 原 reserve.jpg 含底部蓝黑背景边；替换为 Chase 官网 card_sapphireRes-VI_chip_RFID.png 的透明高清图，保留原图归档引用。个人与商业版分开。已在本地资料库搜索 Sapphire Reserve，浏览器截图确认两种卡面正确、个人版底部没有原背景条；钱包和抽屉共用 CardArt，因此也使用同一替换，不需要修改个人快照 art 字段。

来源：
- https://creditcards.chase.com/all-credit-cards
- https://www.chase.com/sapphire-cards/personal/reserve
- https://www.americanexpress.com/hk/en/credit-cards/all-cards/
- https://www.hsbc.com.hk/credit-cards/
- https://www.sc.com/hk/credit-cards/
- https://www.bankofamerica.com/credit-cards/
- https://www.americanexpress.com/ca/en/legal/cardmember-agreements.html

## 界面与验证

新增“卡片资料库”，支持名称/别名搜索、银行筛选、分页、地区标记、来源与资料状态。沿用 Ant Design 默认主题及简繁英。未知卡面不会借用相似产品。旧实验功能继续归档，MVP 采集范围不扩张。

测试包括地区隔离、未知产品、无个人账户信息、错误 productId、歧义别名、应用按钮文字污染排除及 CSR 官方图片优先。此变更不修改用户余额、积分和日期。源码和本地网页已更新；扩展端需单独更新前端文件并重新打开钱包，不需要银行重登。银行后台与本轮运行结果不因卡库新增被标已验收。

最终验证：136 项测试通过、构建成功。浏览器已验证搜索 CSR 只匹配个人版，搜索 Sapphire Reserve 同时展示个人/商业版且各自卡面正确。验收截图任务 outputs/card-catalogue-csr-2026-10-27.png。原扩展目录仅同步前端 index.html 与 assets，共 89 文件逐项一致；background.js 前后 SHA 未变，不重启正在运行的银行采集，不改 data.json/钱包存储/manifest 权限。旧安装文件完整归档 outputs/archive/cardybara-before-catalogue-ui-20261028T001145Z.zip（UTC；业务日期仍为 Chicago 10/27）。更新记录 outputs/card-catalogue-ui-update-2026-10-27.json。

这次未重新生成完整扩展 ZIP，避免将尚待实测的后台源码一并覆盖正在运行版本；本地安装目录前端已可用。下一次打包前须重新构建/打包，不能将旧下载 ZIP 当成本次资料库版本。

## 2026-11-04 更新

产品增至 117 种，美国常见卡片按批次录入，见 [knowledge/US_CARD_COVERAGE.md](knowledge/US_CARD_COVERAGE.md)。新增 Capital One、Discover、U.S. Bank、Wells Fargo 的产品资料，这些银行暂不支持自动读取，卡片上有标注；上文“七家银行”指首批。新增产品暂无卡面图，因为发卡行图片的使用条款未确认。
