# Cardybara 0.2.0-beta.1 — friends beta / 朋友测试版

Status: **ready to tag**, checked against `main` on 2026-11-11 (see "Coverage" at the end). The in-extension page 关于这个版本 / About this version (`src/ReleaseNotes.jsx`) carries the same user-facing content; keep the two in step.

Install guide for testers: [docs/BETA-INSTALL.md](../BETA-INSTALL.md).

---

## 中文

这是给朋友试用的测试版，不是 Chrome 应用商店版本。

### 支持的银行
- **Chase**（美国）和 **American Express 美国**。
- 这个版本不提供连接 American Express 香港、Bank of America、香港汇丰、香港渣打和 Citi。这些银行的卡片可以手动添加到钱包，但余额和账单不会自动读取，很多卡种也还没有福利规则。
- **Bilt** 卡（Blue、Obsidian、Palladium）只能手动添加：不连接银行，余额、账单和 Bilt Rewards 积分都不读取。

### 从银行读取什么
- 每张卡的余额、账单金额、最低还款和还款日。
- American Express Membership Rewards 和 Chase Ultimate Rewards 积分；同一个积分池（例如 Amex 美国的 MR）只显示一次。
- 只读取：不付款、不转账、不兑换积分、不登记优惠，也不改银行设置。登录、密码和手机验证都在银行官网由你本人完成，钱包不读取也不保存它们。

### 你自己填写什么
- **年费日**（持卡周年日）：银行页面不显示；按卡年重置的福利都按这个日期算周期。
- **隐藏卡片**：隐藏后，总览、积分、福利、提醒和用卡助手都当作你没有这张卡；银行刷新照常读取它。
- **积分估值**：每种积分值多少钱，有默认值，可以改；用来比较用哪张卡。
- **手动添加的卡片**：从带卡面的卡种列表里选，可以搜索卡名或品牌。常见的 Chase 和 American Express 美国卡种都在列表里，包括航空和酒店联名卡（例如 United、Southwest、Marriott、Hilton、Delta、IHG、British Airways、Aer Lingus、Iberia、Disney、Amazon）。
- 福利使用记录。

### 用卡助手
- 不需要邀请码，装好就能用。为了控制费用，每个网络每天有使用上限，用完后第二天恢复。不想用可以在 设置 → AI 服务 里关闭。
- 能做：回答持卡、福利、积分和年费周期的问题；比较一笔消费用哪张卡更好。回答边生成边显示。
- 不能做：付款、操作银行、替你登记优惠。
- 它看不到银行余额、账单和还款日；回答里的数字只来自钱包的福利、积分和卡片资料，查不到时会说不知道，不会猜。

### 这个版本还有什么
- 总览里的“这笔消费，用哪张卡？”：选消费类别，直接给出建议用的卡和其他选择，按你的持卡规则和积分估值计算，不含限时优惠。
- 卡片详情和“添加卡片”里，从带卡面的列表里选卡种。
- Chase 和大部分 American Express 美国卡种显示发卡机构公开的卡面图片。

### 隐私
- 钱包数据默认只保存在这台电脑的 Chrome 里，不上传。只有你登录账号并开启“在设备间同步钱包”后，才会存一份到 Cardybara 服务器；银行密码、Cookie、验证码和银行页面内容永远不会上传。
- 用卡助手在 Cardybara 服务上运行：服务收到你的问题、这次对话的前文、持有的卡种、积分估值、每张卡是否填了年费日，以及助手请求的钱包查询结果，交给 AI 模型处理；不收到卡号、余额或账单。服务不保存这些内容，只记录时间、用量和状态；为了限制每个网络每天的用量，只保留网络地址加盐后的哈希值，保留一天。
- AI 识别卡种默认关闭；开启后，或你在卡片详情里点“用 AI 推测卡种”时，会把未识别卡片的银行、地区和卡名（不含尾号和金额）经 Cardybara 服务发给 AI。
- 网页版：钱包数据默认只保存在你输入它的那个浏览器里，不上传。只有你登录账号并开启同步后，才会存一份到服务器，并在登录同一账号的其他设备间合并；银行密码、Cookie、验证码和银行页面内容永远不会上传。
- 开启同步后，上传到服务器的是钱包数据本身：卡片和你对卡片的修改、福利和费用记录、积分估值、提醒设置、付款标记，以及读取到的金额和读取时间；如果你导入过备份，还有备份里的卡片快照。关闭同步后不再上传，服务器上的副本保留，直到你删除账号。
- 没有开启同步时，网页版上传的只有你向用卡助手提的问题，附带的内容和上面一样（对话前文、持有的卡种、积分估值、是否填了年费日、助手请求的钱包查询结果），不含卡号、余额或账单。
- 网页版里的卡片和金额都由你手动填写；读取银行只在桌面版 Chrome 扩展里提供。
- 浏览器可能清除没有添加到主屏幕的网站的数据，请经常在“数据管理”里导出备份。
- 没有广告，也没有使用统计。
- 卸载扩展会删除扩展里的数据；需要保留的话，先在“数据管理 → 导出备份”。

### 已知限制
- 联名卡的积分（航空、酒店等计划）不读取。
- 银行页面没有印年份的日期，按读取当天推断最近的年份，并标明“年份按读取日期推断”。
- 没读到的金额保持未知，不按零计算；银行页面改版可能让读取暂时失败。
- 只在你点击刷新时读取，不会在后台自动刷新；需要手机验证时要你本人在银行完成。
- Chase 和 American Express 美国里，少数卡种只有名称和卡面，没有福利和返现规则：American Express Green，以及 Chase Slate、Slate Edge、DoorDash、Instacart。其他银行的很多卡种暂时只有名称，没有福利规则。
- 部分卡种还没有卡面图片，显示占位图。
- 只在 Chrome 桌面版测试过。

### 反馈问题
读取没完成或有卡片缺少字段时，在“银行连接”里这家银行下面点 **生成问题报告**（扩展图标弹出的小窗里也有），看一遍预览，再点 **保存报告**，把文件发给邀请你的人。报告里的金额、卡号、姓名和日期都已换成占位符；不会自动发送。

也请告诉邀请你的人：哪家银行、哪一步、看到了什么提示。不要发送金额、完整卡号、密码、验证码或银行页面截图。

---

## English

This is a beta for friends, not a Chrome Web Store release.

### Supported banks
- **Chase** (US) and **American Express US**.
- American Express Hong Kong, Bank of America, HSBC Hong Kong, Standard Chartered Hong Kong and Citi cannot be connected in this version. You can add their cards by hand, but their balances and statements are not read, and many of their cards have no benefit rules yet.
- **Bilt** cards (Blue, Obsidian, Palladium) can only be added by hand: the bank is not connected, and balances, statements and Bilt Rewards points are not read.

### What is read from the bank
- Each card's balance, statement amount, minimum payment and due date.
- American Express Membership Rewards and Chase Ultimate Rewards points; a shared pool (such as Amex US MR) is shown once.
- Read only: no payments, transfers, redemptions, offer enrolment or setting changes. You sign in, enter passwords and confirm on your phone on the bank's own site; the wallet never reads or stores them.

### What you enter yourself
- **Annual fee date** (card anniversary): bank pages don't show it; every card-year benefit cycle runs from it.
- **Hidden cards**: the overview, points, benefits, reminders and assistant treat a hidden card as not held; bank refresh still reads it.
- **Point valuations**: what each kind of point is worth, with a default you can change; used when comparing cards.
- **Cards you add by hand**: pick the product from a list with card images, searchable by name or brand. Common Chase and American Express US cards are in it, airline and hotel co-brands included (such as United, Southwest, Marriott, Hilton, Delta, IHG, British Airways, Aer Lingus, Iberia, Disney and Amazon).
- Benefit usage you mark.

### The assistant
- No invite code needed: it works once installed. To keep costs down, each network has a daily limit, which resets the next day. To stop using it, turn it off in Settings → AI service.
- Can: answer questions about your cards, benefits, points and card-year cycles; compare which card to use for a purchase. Answers appear as they are written.
- Cannot: pay, act on your bank, or enrol offers.
- It can't see bank balances, statements or due dates; numbers in its answers come only from the wallet's benefit, points and card data, and when it can't find something it says so instead of guessing.

### Also in this version
- "Which card for this purchase?" on the overview: pick a category and it shows the card to use and the other choices, from your cards' rules and your point valuations, without limited-time offers.
- In card details and **Add card**, pick the product from a list with card images.
- Chase cards and most American Express US cards show the issuer's published card image.

### Privacy
- By default your wallet stays in Chrome on this computer and is not uploaded. A copy goes to the Cardybara server only when you sign in and turn on “Sync wallet between devices”; bank passwords, cookies, one-time codes and bank page content are never uploaded.
- The assistant runs on the Cardybara service: it receives your question, the earlier turns of the conversation, the card products you hold, your point valuations, whether each card has an annual fee date, and the wallet lookups the assistant asks for, and passes them to an AI model; it does not receive card numbers, balances or statements. The service does not store any of it; it records only time, usage and status. To limit each network's daily use, it keeps only a salted hash of the network address, for one day.
- AI card recognition is off by default; when you turn it on, or click “Ask AI for the card type” in card details, the unrecognised card's bank, region and name (no tail or amounts) go through the Cardybara service to the AI.
- Web version: by default your wallet data stays in the browser where you entered it and is not uploaded. A copy goes to the server, and is merged across the devices signed in to the same account, only when you sign in and turn on sync; bank passwords, cookies, one-time codes and bank page content are never uploaded.
- When sync is on, what goes to the server is the wallet data itself: cards and your edits to them, benefit and cost records, point valuations, reminder settings, payment marks, and the amounts read from your bank with when they were read; if you imported a backup, the card snapshot in it too. Turning sync off stops uploads; the server copy stays until you delete the account.
- With sync off, the only thing the web version uploads is the questions you ask the assistant, with the same content as above (earlier turns, the card products you hold, point valuations, whether an annual fee date is filled in, and the wallet lookups the assistant asks for); never card numbers, balances or statements.
- In the web version you enter cards and amounts by hand; reading banks is only available in the desktop Chrome extension.
- A browser may clear the data of a site that is not on the Home Screen, so export a backup often (Data → Export backup).
- No ads and no usage analytics.
- Uninstalling the extension deletes its data; export a backup first (Data → Export backup) if you want to keep it.

### Known limits
- Co-brand points (airline, hotel and similar programmes) are not read.
- A date printed without a year gets the year nearest the day it was read, marked as inferred.
- Amounts that weren't read stay unknown, never zero; a bank page redesign can break reading for a while.
- It reads only when you click refresh, never in the background; phone confirmations must be done by you at the bank.
- Among Chase and American Express US cards, a few have only a name and image, with no benefit or earning rules: American Express Green, and Chase Slate, Slate Edge, DoorDash and Instacart. Many cards of other banks have only a name for now, with no benefit rules.
- Some cards have no card image yet and show a placeholder.
- Tested on desktop Chrome only.

### Reporting a problem
When a read doesn't finish or a card is missing a field, click **Create problem report** under that bank in **Bank connections** (the extension's toolbar pop-up has it too), read the preview, then click **Save report** and send the file to the person who invited you. Amounts, card numbers, names and dates in the report are replaced with placeholders; nothing is sent automatically.

Also tell the person who invited you which bank, which step, and what message you saw. Never send amounts, full card numbers, passwords, codes or screenshots of bank pages.

---

## Coverage (maintainers)

Checked against `main` on 2026-11-11. Covered above: beta bank scope and this page (#197, #218), hosted gateway (#215; invite codes dropped 2026-11-16), assistant on the gateway with streaming (#210: #219, #227), common Chase and Amex US cards (#195: #216, #220, #224, #225, #229), problem report (#196: #200), Bilt as a manual-only issuer (#234), Amex US card art (#232), purchase chooser redesign (#223), visual card picker (#207), annual fee date (#209), hide a card (#203), pooled MR/UR (#206), point valuations (#202), yearless due dates (#191).

Not in this beta: niche Chase cards' rules (Slate, Slate Edge, DoorDash, Instacart — #235); Amex Green has no rules yet. Card art for other issuers (#233) was open when this was written; if it merges before the tag, the notes stay true (they promise art for Amex US and Chase only).
