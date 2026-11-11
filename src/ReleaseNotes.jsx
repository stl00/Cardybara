import React from 'react';
import {Alert,Card,Space,Tag,Typography} from 'antd';
import {ACTIVE_BANKS,CONNECTABLE_BANKS,SCOPED,bankOrder} from '../extension-next/providers.js';
import release from '../release.json' with {type:'json'};
import {BankIdentity,bankLabel} from './Identity';
import {t,useI18n} from './i18n';
const {Paragraph,Text}=Typography;
// "关于这个版本": what this build reads, what the user enters, what the assistant can do and where data goes.
// docs/release-notes/ holds the same notes for each release; keep the two in step.
const List=({items})=><ul className="release-notes-list">{items.map(item=><li key={item}>{t(item)}</li>)}</ul>;
export default function ReleaseNotes(){
 useI18n();
 const others=bankOrder(ACTIVE_BANKS).filter(b=>!CONNECTABLE_BANKS.includes(b));
 return <Space orientation="vertical" size={20} style={{width:'100%'}} className="release-notes">
  <Alert type="info" showIcon title={t('版本 {0}',[release.label])} description={release.channel==='beta'?t('这是给朋友试用的测试版，不是 Chrome 应用商店版本。功能和银行页面都可能变化，遇到问题请告诉我们。'):t('这是内部测试版，不是 Chrome 应用商店版本。')}/>
  <Card title={t('支持的银行')}>
   <Space wrap>{bankOrder(CONNECTABLE_BANKS).map(b=><Tag key={b}><BankIdentity bank={b} size={20}/></Tag>)}</Space>
   {SCOPED&&others.length>0&&<Paragraph type="secondary" style={{marginTop:12,marginBottom:0}}>{t('这个版本不提供连接：{0}。这些银行的卡片可以手动添加到钱包，但余额和账单不会自动读取。',[others.map(bankLabel).join(t('、'))])}</Paragraph>}
  </Card>
  <Card title={t('从银行读取什么')}>
   <List items={['每张卡的余额、账单金额、最低还款和还款日。','American Express Membership Rewards 和 Chase Ultimate Rewards 积分；同一个积分池只显示一次。','只读取，不付款、不转账、不兑换积分、不登记优惠，也不改银行设置。','登录、密码和手机验证都在银行官网由你自己完成，钱包不读取也不保存它们。']}/>
  </Card>
  <Card title={t('你自己填写什么')}>
   <List items={['年费日（持卡周年日）：银行页面不显示，用来计算按卡年重置的福利。','隐藏的卡片：隐藏后总览、积分、福利、提醒和用卡助手都当作你没有这张卡。','积分估值：每种积分值多少钱，用来比较用哪张卡。','手动添加的卡片和福利使用记录。']}/>
  </Card>
  <Card title={t('用卡助手')}>
   <List items={['需要邀请码：在设置的“AI 服务”里输入邀请你的人给的邀请码。不输入也能正常使用钱包，只是没有聊天助手。','可以回答持卡、福利、积分和还款的问题，也可以比较一笔消费用哪张卡更好。','不能付款、不能操作银行、不能替你登记优惠。','回答里的金额和日期只来自钱包里的数据；查不到时会说不知道，不会猜。']}/>
  </Card>
  <Card title={t('隐私')}>
   <List items={['钱包数据保存在这台电脑的 Chrome 里，不上传，也不同步。','和用卡助手的聊天会经过 Cardybara 服务转交 AI 模型处理。服务不保存聊天内容，只记录邀请码编号、时间、用量和状态。','没有广告，也没有使用统计。','卸载扩展会删除扩展里的数据；需要保留的话，先在“数据管理”里导出备份。']}/>
  </Card>
  <Card title={t('已知限制')}>
   <List items={['联名卡的积分（例如航空或酒店计划）不读取。','银行页面没有印年份的日期，按读取当天推断最近的年份，并标明是推断的。','没读到的金额保持未知，不按零计算；银行页面改版可能让读取暂时失败。','Chrome 关闭时不会刷新；需要手机验证时要你本人在银行完成。']}/>
  </Card>
  <Card title={t('反馈问题')}>
   <Paragraph>{t('请告诉邀请你的人：哪家银行、哪一步、看到了什么提示。')}</Paragraph>
   <Text type="secondary">{t('不要发送金额、完整卡号、密码、验证码或银行页面截图。')}</Text>
  </Card>
 </Space>;
}
