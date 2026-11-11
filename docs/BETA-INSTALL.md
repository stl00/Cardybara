# Cardybara 朋友测试版安装指南 / Friends beta install guide

For the build described in [release-notes/beta-1.md](release-notes/beta-1.md). This beta reads **Chase** and **American Express US** only.

---

## 中文

### 1. 下载
1. 打开邀请你的人发来的 GitHub Release 链接（https://github.com/stl00/Cardybara/releases ），下载 `cardybara-<版本>.zip`。
2. 解压到一个你不会删掉的文件夹，例如“文稿/Cardybara”。以后 Chrome 每次都从这个文件夹加载扩展，**不要删除或移动它**。

### 2. 在 Chrome 里加载
1. 在 Chrome 地址栏打开 `chrome://extensions`。
2. 打开右上角的“开发者模式”。
3. 点“加载已解压的扩展程序”，选中刚才解压出来、里面有 `manifest.json` 的文件夹。
4. 列表里出现 “Cardybara · 卡疲扒拉 Beta” 就装好了。

### 3. 固定到工具栏
点 Chrome 右上角的拼图图标，找到 Cardybara，点旁边的图钉。之后点 Cardybara 图标就能打开钱包。

### 4. 输入邀请码（用卡助手）
1. 在钱包左侧打开“设置”，找到“AI 服务”。
2. 粘贴邀请你的人发给你的邀请码，点“保存邀请码”。
3. Chrome 会问是否允许扩展访问 Cardybara 服务，选“允许”。
不输入邀请码也能正常使用钱包，只是没有聊天助手。邀请码只给你自己用，不要转发。

### 5. 连接 Chase 和 Amex US
1. 打开“银行连接”，在 Chase 或 American Express 美国 卡片上点“连接银行”。
2. 扩展会打开银行官网。**你自己**登录、输入密码、完成手机验证——这些只交给银行。
3. 登录后页面上会出现 Cardybara 的引导条，钱包自动读取；如果没有自动开始，在引导条点“读取本页”。
4. 回到钱包查看结果。没读到的项目保持未知，不会填零。
其他银行在这个版本里不提供连接；它们的卡可以用“添加卡片”手动记下，但余额不会自动更新。

### 6. 钱包会读取什么、不会读取什么
- 会读取：每张卡的余额、账单金额、最低还款、还款日；Amex Membership Rewards 和 Chase Ultimate Rewards 积分。
- 不会读取：密码、验证码、cookie、完整卡号；交易明细；联名卡的航空或酒店积分。
- 不会做：付款、转账、兑换积分、登记优惠、改银行设置。
- 年费日、隐藏卡片、积分估值由你自己在钱包里填写。

### 7. 反馈问题
告诉邀请你的人：哪家银行、哪一步、看到了什么提示。**不要**发送金额、完整卡号、密码、验证码或银行页面截图。

### 8. 卸载并删除数据
1. 想保留记录的话，先在钱包“数据管理 → 导出备份”，把 JSON 文件存到安全的地方（里面有你的金额，别发给别人）。
2. 打开 `chrome://extensions`，在 Cardybara 上点“移除”。扩展保存的钱包、设置和邀请码会一起删除。
3. 删除第 1 步解压的文件夹，以及你导出过的备份文件（如果不再需要）。

---

## English

### 1. Download
1. Open the GitHub Release link from the person who invited you (https://github.com/stl00/Cardybara/releases) and download `cardybara-<version>.zip`.
2. Unzip it into a folder you will keep, such as Documents/Cardybara. Chrome loads the extension from this folder every time, so **don't delete or move it**.

### 2. Load it in Chrome
1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the unzipped folder that contains `manifest.json`.
4. "Cardybara · 卡疲扒拉 Beta" appears in the list.

### 3. Pin it
Click the puzzle-piece icon at the top right of Chrome, find Cardybara and click the pin. Click the Cardybara icon to open your wallet.

### 4. Enter your invite code (assistant)
1. In the wallet, open **Settings** and find **AI service**.
2. Paste the invite code you were sent and click **Save invite code**.
3. Chrome asks whether the extension may reach the Cardybara service; choose **Allow**.
The wallet works without a code, just without the chat assistant. The code is for you only; don't pass it on.

### 5. Connect Chase and Amex US
1. Open **Bank connections** and click **Connect bank** on Chase or American Express US.
2. The extension opens the bank's site. **You** sign in, enter your password and confirm on your phone — these go only to the bank.
3. After sign-in, the Cardybara guide bar appears and the wallet reads automatically; if it doesn't start, click **读取本页** ("read this page") on the guide bar.
4. Go back to the wallet to see the results. Anything not read stays unknown; it is never filled with zero.
Other banks can't be connected in this version; you can still note their cards with **Add card**, but their balances won't update.

### 6. What the wallet reads and doesn't
- Reads: each card's balance, statement amount, minimum payment and due date; Amex Membership Rewards and Chase Ultimate Rewards points.
- Never reads: passwords, codes, cookies, full card numbers; transactions; co-brand airline or hotel points.
- Never does: payments, transfers, redemptions, offer enrolment, bank setting changes.
- You enter the annual fee date, hidden cards and point valuations yourself.

### 7. Report a problem
Tell the person who invited you which bank, which step, and what message you saw. **Never** send amounts, full card numbers, passwords, codes or screenshots of bank pages.

### 8. Uninstall and remove your data
1. To keep your records, first use **Data → Export backup** in the wallet and store the JSON file somewhere safe (it contains your amounts; don't share it).
2. Open `chrome://extensions` and click **Remove** on Cardybara. The wallet, settings and invite code stored by the extension are deleted with it.
3. Delete the folder you unzipped in step 1, and any backup files you no longer need.
