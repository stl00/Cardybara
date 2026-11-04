# Cardybara 本地开发与验收

本地和 Chrome 扩展是同一个产品，使用同一份 React 界面、解析器、校验器和任务状态机。localhost 是开发运行方式，Chrome 扩展是发布容器，不分别维护两套产品。

## 日常循环

1. `npm ci`，首次运行 `npm run init:local`。初始化只创建空钱包，已有数据不覆盖；新用户不需要旧备份。
2. `npm run dev` 从源码启动 Vite 与共享模型 API。源码变化直接反映到浏览器。`npm run preview:wallet` 只预览已构建页面，不作为日常开发入口。
3. 使用脱敏银行页面样本复现字段、关联、缺失值、日期及导航问题。`npm run check:fixtures` 校验样本，`npm run debug:bank` 同时运行当前完整回归列表。
4. 本地修复与验证后提交代码，由 PR CI 测试、构建并生成扩展候选包。日常开发不手工复制安装目录，不为每次修改要求用户重装或导出。
5. 对 CI 生成的固定包集中验收 Chrome 权限、后台生命周期、真实银行读取与写回、重启及升级保存，然后才发布。

同一空钱包模板 `public/data.example.json` 供本地初始化和发布包使用，避免默认银行列表等差异。开发 API 与构建预览共用 `scripts/dev-server.mjs` 的处理器。模型密钥留在服务端 `.env.local`，也可通过 `CARDYBARA_MODEL_CONFIG` 指向自己的配置文件，不进入客户端与安装包。

## 本地真实采集（不安装扩展）

`npm run dev` 同时以子进程启动 `scripts/dev-collector/`：在 Node 下运行未修改的 `extension-next/background.js`，由 Chrome API adapter 通过 DevTools 协议驱动一个专用 Chrome。页面显示“浏览器采集已就绪”后，用钱包的正常入口点“连接银行”或“刷新银行”。

- 专用 Chrome 在第一次刷新时才启动，用独立 profile，调试端口只绑定 127.0.0.1。档案和采集状态都在被 Git 忽略的 `.debug/dev-collector/`（可用 `CARDYBARA_COLLECTOR_HOME` 改位置）。登录、验证码和手机确认都由本人在这个窗口完成。
- 修改 `extension-next/*.js` 或 `scripts/dev-collector/*.mjs` 后 service 自动重启，Chrome 和银行登录保留，不需要动 Chrome 的扩展页面。未完成的任务按既有规则标记为 interrupted，重新点刷新即可。
- adapter 自身只能发送 `cdp.mjs` 白名单内的方法：不含 Network、Storage、Input，脚本只在隔离 world 运行。可注入的站点和可见的标签页 URL 与 manifest 的 host permissions 一致，页面端的消息通道只接受当前文档的隔离 world。
- **残余风险：** 白名单只约束 adapter。调试端口没有鉴权，专用 Chrome 开着时，本机任何进程（多用户机器上也包括其他用户的进程）都能连接它，包括读取已登录银行的 cookie。专用 Chrome 不随 `npm run dev` 退出；不用时请关闭窗口，尤其是登录过银行之后。隔离 world 也能访问 `document.cookie`，所以“不读 cookie”靠的是注入的代码本身不去读，与扩展相同。
- 银行拒绝文档请求（403/429/451）、显示常见拦截页或在正在读取的任务中离开允许的域名时，run 立即停止，后面排队的银行也不再继续并在钱包报错，不重试、不绕过。这是尽力检测：后台请求被拒或换了标题的拦截页看不到，这时结果会是读取失败。
- 关闭专用 Chrome 会停止当前 run，之后不会自动重开；下次点刷新才启动。
- `CARDYBARA_DEV_COLLECTOR=0` 关闭。这是 dev-only 代码：`vite build` 不包含，`scripts/audit-release.py --package` 检查发布包。

合成演练（目录一旦用于合成或真实模式就不能混用）：`CARDYBARA_COLLECTOR_HOME=<临时目录> CARDYBARA_SYNTHETIC_BANK=page npm run dev`。此模式把已接管标签页的 HTTPS 请求答复为 `tests/fixtures/synthetic-bank.html`，并让专用 Chrome 的所有 DNS 解析失败，因此连不到银行；`CARDYBARA_SYNTHETIC_BANK=blocked` 演练被拦截。`npm run test:collector-chrome` 用真实 headless Chrome 跑 adapter，也在 CI 中运行。以上都属于“流程回归”，不是真实终验。

## 银行拒绝自动化时

如果银行拒绝专用 Chrome、拦截 Claude 的工具，或者出现验证，Claude 就停下并报告。**被拒绝的银行不能换一个浏览器由 Claude 重试**，不管 owner 是否同意，因为这可能等于绕过 bot 检测。日常 Chrome、其他 profile 或其他驱动方式都算换浏览器。

这家银行之后只走插件自身的路线：由 owner 安装，由插件自己的代码读页面。如果银行也拒绝插件，就标记为不支持，不再找别的办法。

2026-11-04 曾在 owner 的日常 Chrome 里读过 HSBC HK、Amex US 和 Amex HK 各一次，当时用的是后来撤回的授权。这些观察已经写成规则，不再重复。写进 PR 时要注明证据来自这次运行。这种比对只覆盖发现、切卡和金额规则，不证明 `capturePage`、校验器和钱包写回能走通；这些仍靠合成页面上的真实 Chrome 测试，安装版验收保持 `not_run`。

## 账户之外的卡片

开发账户相当于训练集，读通它不说明别人的卡也能读。账单字段和发现卡片都跟页面结构走，卡名只是读到的数据，不能决定某张卡是否被读取。

- `tests/out-of-sample.test.mjs` 在新的产品名或积分计划名进入 `extension-next/` 时失败；允许的名字逐个文件列出并说明理由。`npm run test:collector-chrome` 在真实 Chrome 里用生成的页面变化卡名、数量和顺序。
- 发现卡片看账户名称行和掩码行：非卡账户和只是提到账号的文字会被跳过，并计入 `skipped`（钱包里暂未显示）。这是排除法，既可能把名单外的非卡账户当成卡，也可能漏掉名称里带这些词的真卡。没读到的卡可以手动添加。
- 遇到没见过的页面：在专用 Chrome 打开该页，运行 `npm run diagnose:bank`。报告写到被忽略的 `.debug/structure/`，只保留元素结构、词表内的通用词和数值形状，其他词一律替换。与通用词相同的名字（例如 Cash Rewards）会留下，发出前请自己再看一遍。

证据要分开报告：合成测试只覆盖想得到的布局。真实证据目前只来自一个开发账户，要说“其他账户可用”，每家银行至少要有一位持不同卡的测试者；测试者的真实数据不进仓库。

## 三层证据

| 检查 | 输入 | 通过含义 |
| --- | --- | --- |
| 字段回放 | 已收录脱敏或合成页面样本、明确期望、正式解析函数 | 这些样本可重复解析，缺失和歧义未被猜测 |
| 流程回归 | 模拟 Chrome/银行传输，正式任务状态机与后台模块 | 登录后继续、取消、迟到结果、错误恢复和保存等模拟流程符合预期 |
| 真实终验 | 官网可见值、对应运行版本、同轮实际写回 | 指定银行和卡片的字段真实一致 |

报告在被 Git 忽略的 `.debug/`，日常回放不连接银行、不调用云模型、不修改真实钱包。格式不支持的样本必须产生失败报告，不能被跳过或计为通过。真实验收未运行时保持 `not_run`；文件更新或测试通过不能改为成功。

当前已收录样本的覆盖情况以运行报告为准；没有样本的银行不能声称已覆盖。每个字段保留自己的采集日期；未读到的字段保留原值或未知状态，不填零。还款日不得猜年份，可用额度不作余额，不把历史结单余额改名为未缴账单，不擅自合计积分池。

## MVP 范围

银行区域：Amex US、Amex HK、Chase、Bank of America、HSBC HK、Standard Chartered HK、Citi US。Amex Canada 已归档，代码和样本保留，默认关闭。每张卡都要读余额、账单金额、最低还款和还款日；积分只要求 Amex Membership Rewards 和 Chase Ultimate Rewards，其他积分计划的代码保留但默认不运行，显示为“此版本不采集”。

## 推送前扫描 owner 私有值（可选）

CI 只检查形状，不知道真实值。`scripts/hooks/pre-push` 在本机把这些值和即将推送的内容比对，默认不启用。owner 执行一次即可，所有 worktree 共用：

```sh
git config core.hooksPath scripts/hooks && git config cardybara.privateNeedles ~/.config/cardybara/private-needles.txt
```

值文件由 owner 自己创建，放在仓库外，每行一个值（卡尾号、姓名、邮箱等），不要提交或上传。环境变量 `CARDYBARA_PRIVATE_NEEDLES` 优先于上面的 git config；`scripts/audit-release.py` 只读环境变量，设置后也会扫描源码和 `--package` 的 ZIP。

- 范围：尚未到达这次推送目标 remote 的每个 commit（文件内容、文件名、作者和 committer 信息、提交说明，包括后来又被删掉的值）、ref 名和 annotated tag 说明，以及本机 `release/*.zip`。已推到其他 remote 不算已公开，仍会扫描。
- 短数字：少于 5 位的纯数字只在卡尾号写法里算命中（`ending NNNN`、`last4: NNNN`、`尾号NNNN`、`••••NNNN`、`xxxxNNNN`、`...NNNN`），所以年费、版本号不会误报。代价是不带这些写法的短数字不会被发现，金额这类值请写成 5 位以上的完整形式。
- 失败时只报文件名或 commit，不输出值或所在行；文件名本身含有列出的值时也不打印。启用后值文件缺失、为空或位于仓库内都会阻止推送，避免把“没扫”当成“干净”。
- 这是本机防线，不是保证：`git push --no-verify` 可以跳过，没有这个 hook 文件的旧分支也不会扫描。`core.hooksPath` 还会让 `.git/hooks` 里的其他 hook 不再生效。关闭：`git config --unset core.hooksPath`。

## 浏览器边界

普通 localhost 页面和银行网页可用于开发验证。工具禁止观察 `chrome-extension:` 页面时，不通过扩展存储、调试后门或其他界面绕过。解析与流程问题先在本地样本中解决；必要的最终安装与写回证据由用户正常操作并提供，不将逐次导出作为日常调试方式。实际银行金额、账户标识、截图和运行导出不得进入公开 Git 历史或 CI 产物。
