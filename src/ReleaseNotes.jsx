import React from 'react';
import {Alert,Card,Space,Tag,Typography} from 'antd';
import {ACTIVE_BANKS,BUILD_SCOPE,CONNECTABLE_BANKS,SCOPED,bankOrder} from '../extension-next/providers.js';
import release from '../release.json' with {type:'json'};
import {BankIdentity,bankName} from './Identity';
import {t,useI18n} from './i18n';
const {Paragraph,Text}=Typography;
// "关于这个版本": what this build reads, what the user enters, what the assistant can do and where data goes.
// docs/release-notes/ holds the same notes for each release; keep the two in step.
const List=({items})=><ul className="release-notes-list">{items.map(item=><li key={item}>{t(item)}</li>)}</ul>;
export default function ReleaseNotes(){
 useI18n();
 const others=bankOrder(ACTIVE_BANKS).filter(b=>!CONNECTABLE_BANKS.includes(b));
 return <Space orientation="vertical" size={20} style={{width:'100%'}} className="release-notes" data-build-scope={BUILD_SCOPE}>
  <Alert type="info" showIcon title={t('版本 {0}',[release.label])} description={release.channel==='beta'?t('这是给朋友试用的测试版，不是 Chrome 应用商店版本。功能和银行页面都可能变化，遇到问题请告诉我们。'):t('这是内部测试版，不是 Chrome 应用商店版本。')}/>
  <Card title={t('支持的银行')}>
   <Space wrap>{bankOrder(CONNECTABLE_BANKS).map(b=><Tag key={b}><BankIdentity bank={b} size={20}/></Tag>)}</Space>
   {SCOPED&&others.length>0&&<Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('这个版本不提供连接：{0}。这些银行的卡片可以手动添加到钱包，但余额和账单不会自动读取。',[others.map(bankName).join(t('、'))])}</Paragraph>}
   <Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('Bilt 卡只能手动添加：不连接银行，余额、账单和 Bilt Rewards 积分都不读取。')}</Paragraph>
  </Card>
  <Card title={t('从银行读取什么')}>
   <List items={['每张卡的余额、账单金额、最低还款和还款日。','American Express Membership Rewards 和 Chase Ultimate Rewards 积分；同一个积分池只显示一次。','只读取，不付款、不转账、不兑换积分、不登记优惠，也不改银行设置。','登录、密码和手机验证都在银行官网由你自己完成，钱包不读取也不保存它们。']}/>
  </Card>
  <Card title={t('你自己填写什么')}>
   <List items={['年费日（持卡周年日）：银行页面不显示，用来计算按卡年重置的福利。','隐藏的卡片：隐藏后总览、积分、福利、提醒和用卡助手都当作你没有这张卡。','积分估值：每种积分值多少钱，有默认值，可以改；用来比较用哪张卡。','手动添加的卡片：从带卡面的卡种列表里选；常见的 Chase 和 American Express 美国卡种（包括航空、酒店联名卡）都在列表里。','福利使用记录。']}/>
  </Card>
  <Card title={t('用卡助手')}>
   <List items={['需要邀请码：在设置的“AI 服务”里输入邀请你的人给的邀请码。不输入也能正常使用钱包，只是没有聊天助手。','可以回答持卡、福利、积分和年费周期的问题，也可以比较一笔消费用哪张卡更好。回答边生成边显示。','不能付款、不能操作银行、不能替你登记优惠。','它看不到银行余额、账单和还款日；回答里的数字只来自钱包的福利、积分和卡片资料，查不到时会说不知道，不会猜。']}/>
  </Card>
  <Card title={t('这个版本还有什么')}>
   <List items={['总览里的“这笔消费，用哪张卡？”：选消费类别，直接给出建议用的卡和其他选择，按你的持卡规则和积分估值计算。','卡片详情和添加卡片时，从带卡面的列表里选卡种，可以搜索卡名或品牌。','American Express 美国和 Chase 的卡种显示发卡机构公开的卡面图片。']}/>
  </Card>
  <Card title={t('隐私')}>
   <List items={['钱包数据保存在这台电脑的 Chrome 里，不上传，也不同步。','用卡助手在 Cardybara 服务上运行：服务收到你的问题、持有的卡种和助手请求的钱包查询结果，交给 AI 模型处理；不收到卡号、余额或账单。服务不保存这些内容，只记录邀请码编号、时间、用量和状态。','没有广告，也没有使用统计。','卸载扩展会删除扩展里的数据；需要保留的话，先在“数据管理”里导出备份。']}/>
  </Card>
  <Card title={t('已知限制')}>
   <List items={['联名卡的积分（例如航空或酒店计划）不读取。','银行页面没有印年份的日期，按读取当天推断最近的年份，并标明是推断的。','没读到的金额保持未知，不按零计算；银行页面改版可能让读取暂时失败。','只在你点击刷新时读取，不会在后台自动刷新；需要手机验证时要你本人在银行完成。','少数卡种只有名称和卡面，没有福利和返现规则：American Express Green，以及 Chase Slate、Slate Edge、DoorDash、Instacart。','部分卡种还没有卡面图片，显示占位图。','只在 Chrome 桌面版测试过。']}/>
  </Card>
  <Card title={t('反馈问题')}>
   <Paragraph>{t('读取没完成或有卡片缺少字段时，在“银行连接”里这家银行下面点“生成问题报告”，看一遍预览，再点“保存报告”，把文件发给邀请你的人。报告里的金额、卡号、姓名和日期都已换成占位符，不会自动发送。')}</Paragraph>
   <Paragraph>{t('也请告诉邀请你的人：哪家银行、哪一步、看到了什么提示。')}</Paragraph>
   <Text type="secondary">{t('不要发送金额、完整卡号、密码、验证码或银行页面截图。')}</Text>
  </Card>
 </Space>;
}
