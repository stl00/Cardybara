# Cardybara · 卡皮扒拉 Chrome 采集扩展 · 1.0

安装文件夹需要包含 manifest.json、background.js、reader.js、dashboard.js。

1. Chrome 地址栏打开 chrome://extensions，启用开发者模式。
2. 点击“加载已解压的扩展程序”，选取本文件夹。
3. 在同一个 Chrome 中打开 http://127.0.0.1:8766/ 并重新加载。
4. Dashboard 显示“Chrome 采集扩展已连接”后，点击“刷新全部账户”或某张卡的“刷新此账户”。

## 真实刷新流程

重新加载现有银行标签页；没有对应标签页则打开银行登录页。仅读取已呈现的网页文本，按已知尾号关联，回传能可靠识别的余额、可用额度、账单金额和最低还款。单卡按钮只接受该卡的结果。全局和银行按钮分别刷新全部或某家银行的卡。

登录过期、验证码、手机推送、页面无法读取会显示状态；用户本人完成银行验证后重试。扩展不会输入凭证、批准验证、点击付款或修改银行设置。

目前是初版解析器：没有在获准安装后的真实银行页面验证；银行页面的多卡布局、iframe、国际版本或标签变更可能导致无法识别。积分、优惠和交易暂保留历史采集记录。扩展不会把打开银行网站视为数据刷新成功。

## 权限与数据

- scripting：只在列出的官方银行域名执行随扩展打包的页面读取代码。
- host_permissions：Amex（www/global.americanexpress.com）、Chase（secure.chase.com）、BOA（www/secure.bankofamerica.com）、香港汇丰（www.hsbc.com.hk、www.ebanking.hsbc.com.hk、www.security.online-banking.hsbc.com.hk）、渣打（retail.sc.com、www.sc.com），以及此专属 Dashboard。
- 不请求 Cookie、浏览历史、密码、下载、调试器或所有网站权限。
- 不读取 input.value，不持久保存网页全文、完整卡号或会话凭证。
- 银行读数只回传到上述 Dashboard，本地 localStorage 保存已识别字段与时间；可通过“导出快照”备份。
- 不上传到另一个数据库；其他浏览器和设备不会自动拥有这份本地读数。
- 扩展不运行远程脚本，不对银行发起 API 抓取请求。Chrome 关闭时按钮无法工作。

卸载：chrome://extensions 移除 Cardybara · 卡皮扒拉。清除读数：Dashboard 网站设置中清除本站本地存储。
