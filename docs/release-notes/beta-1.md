# Cardybara 0.2.0-beta.1 — friends beta / 朋友测试版

Status: **draft**, written against `main` on 2026-11-11. Final pass right before the owner tags `v0.2.0-beta.1` (see "Before tagging" at the end). The in-extension page 关于这个版本 / About this version (`src/ReleaseNotes.jsx`) carries the same user-facing content; keep the two in step.

Install guide for testers: [docs/BETA-INSTALL.md](../BETA-INSTALL.md).

---

## 中文

这是给朋友试用的测试版，不是 Chrome 应用商店版本。

### 支持的银行
- **Chase**（美国）和 **American Express 美国**。
- 这个版本不提供连接 American Express 香港、Bank of America、香港汇丰、香港渣打和 Citi。这些银行的卡片可以手动添加到钱包（看福利、问用卡助手），但余额和账单不会自动读取。

### 从银行读取什么
- 每张卡的余额、账单金额、最低还款和还款日。
- American Express Membership Rewards 和 Chase Ultimate Rewards 积分；同一个积分池（例如 Amex 美国的 MR）只显示一次。
- 只读取：不付款、不转账、不兑换积分、不登记优惠，也不改银行设置。登录、密码和手机验证都在银行官网由你本人完成，钱包不读取也不保存它们。

### 你自己填写什么
- **年费日**（持卡周年日）：银行页面不显示；按卡年重置的福利都按这个日期算周期。
- **隐藏卡片**：隐藏后，总览、积分、福利、提醒和用卡助手都当作你没有这张卡；银行刷新照常读取它。
- **积分估值**：每种积分值多少钱，有默认值，可以改；用来比较用哪张卡。
- 手动添加的卡片（从卡片资料库里选卡种），以及福利使用记录。

### 用卡助手
- 需要邀请码：在 设置 → AI 服务 输入邀请你的人给的邀请码。不输入也能正常使用钱包，只是没有聊天助手和 AI 识别卡种。
- 能做：回答持卡、福利、积分和还款的问题；比较一笔消费用哪张卡更好。
- 不能做：付款、操作银行、替你登记优惠。
- 回答里的金额和日期只来自钱包工具读出的数据；查不到时会说不知道，不会猜。

### 隐私
- 钱包数据保存在这台电脑的 Chrome 里，不上传，也不同步。
- 和用卡助手的聊天经过 Cardybara 服务转交 AI 模型处理。服务不保存聊天内容，只记录邀请码编号、时间、用量和状态。银行余额和账单不经过 Cardybara 服务。
- 没有广告，也没有使用统计。
- 卸载扩展会删除扩展里的数据；需要保留的话，先在“数据管理 → 导出备份”。

### 已知限制
- 联名卡的积分（航空、酒店等计划）不读取。
- 银行页面没有印年份的日期，按读取当天推断最近的年份，并标明“年份按读取日期推断”。
- 没读到的金额保持未知，不按零计算；银行页面改版可能让读取暂时失败。
- Chrome 关闭时不会刷新；需要手机验证时要你本人在银行完成。
- 只在 Chrome 桌面版测试过。

### 反馈问题
告诉邀请你的人：哪家银行、哪一步、看到了什么提示。不要发送金额、完整卡号、密码、验证码或银行页面截图。

---

## English

This is a beta for friends, not a Chrome Web Store release.

### Supported banks
- **Chase** (US) and **American Express US**.
- American Express Hong Kong, Bank of America, HSBC Hong Kong, Standard Chartered Hong Kong and Citi cannot be connected in this version. You can add their cards by hand (for benefits and the assistant), but their balances and statements are not read.

### What is read from the bank
- Each card's balance, statement amount, minimum payment and due date.
- American Express Membership Rewards and Chase Ultimate Rewards points; a shared pool (such as Amex US MR) is shown once.
- Read only: no payments, transfers, redemptions, offer enrolment or setting changes. You sign in, enter passwords and confirm on your phone on the bank's own site; the wallet never reads or stores them.

### What you enter yourself
- **Annual fee date** (card anniversary): bank pages don't show it; every card-year benefit cycle runs from it.
- **Hidden cards**: the overview, points, benefits, reminders and assistant treat a hidden card as not held; bank refresh still reads it.
- **Point valuations**: what each kind of point is worth, with a default you can change; used when comparing cards.
- Cards you add by hand (picked from the card catalogue) and benefit usage you mark.

### The assistant
- Needs an invite code: Settings → AI service, enter the code from the person who invited you. Without it the wallet works, just without the chat assistant and AI card recognition.
- Can: answer questions about your cards, benefits, points and payments; compare which card to use for a purchase.
- Cannot: pay, act on your bank, or enrol offers.
- Amounts and dates in answers come only from what the wallet's tools read; when it can't find something it says so instead of guessing.

### Privacy
- Your wallet stays in Chrome on this computer; it is not uploaded or synced.
- Chat goes through the Cardybara service to an AI model. The service does not store the chat; it records only the invite code's id, time, usage and status. Bank balances and statements do not go through the Cardybara service.
- No ads and no usage analytics.
- Uninstalling the extension deletes its data; export a backup first (Data → Export backup) if you want to keep it.

### Known limits
- Co-brand points (airline, hotel and similar programmes) are not read.
- A date printed without a year gets the year nearest the day it was read, marked as inferred.
- Amounts that weren't read stay unknown, never zero; a bank page redesign can break reading for a while.
- Nothing refreshes while Chrome is closed; phone confirmations must be done by you at the bank.
- Tested on desktop Chrome only.

### Reporting a problem
Tell the person who invited you which bank, which step, and what message you saw. Never send amounts, full card numbers, passwords, codes or screenshots of bank pages.

---

## Before tagging (maintainers)

Merged on `main` and covered above: hosted invite-code gateway (#215), visual card picker (#207), annual fee date (#209), hide a card (#203), pooled MR/UR (#206), point valuations (#202), yearless due dates (#191), beta bank scope and this page (#197).

Still in progress — re-check each right before tagging and update both this file and `src/ReleaseNotes.jsx`:
- [ ] **#210 cloud agent** — if merged, re-check the assistant's capabilities, limits and the privacy line (what the chat sends through the gateway).
- [ ] **#195 common cards** — if merged, mention the catalogue additions under "What you enter yourself".
- [ ] **#196 problem report** — if merged, replace "Reporting a problem" with how to save and send the sanitized report from the extension (here, in the About page and in BETA-INSTALL.md).
