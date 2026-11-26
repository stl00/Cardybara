import React from 'react';
import {Button,Flex,Typography} from 'antd';
import release from '../release.json' with {type:'json'};
import {t,useI18n} from './i18n';
import platform from './platform';
const {Paragraph,Text,Title,Link}=Typography;
const REPO='https://github.com/stl00/Cardybara/blob/main/';
export const AUTHOR='Ollie Sun';
// "关于 Cardybara": what the app is, which version, who made it, and where the data on screen comes from (#662).
// The body of the modal the footer, the data menu and the phone More sheet open; main.jsx owns the modal.
export default function About({collects,cardCount,onRelease}){
 useI18n();
 return <div className="about-view">
  <Title level={5} style={{marginTop:0}}>{t('Cardybara · 卡疲扒拉')}</Title>
  <Paragraph>{t('一个钱包看清信用卡账单、还款日、积分和福利。')}</Paragraph>
  <Paragraph><Text type="secondary">{t('版本 {0}',[platform.commit??release.label])}</Text><br/><Text type="secondary">{t('作者：{0}',[AUTHOR])}</Text></Paragraph>
  <Flex wrap gap="0 16px" align="center" className="about-links">
   <Link href={REPO+'PRIVACY.md'} target="_blank" rel="noopener noreferrer">{t('隐私说明')}</Link>
   <Link href={REPO+'SECURITY.md'} target="_blank" rel="noopener noreferrer">{t('安全问题反馈')}</Link>
   <Button type="link" onClick={onRelease}>{t('版本说明')}</Button>
  </Flex>
  <Title level={5}>{t('数据来源与说明')}</Title>
  <Paragraph>{collects?t('刷新银行会重新访问银行网页；导入备份只恢复已保存的数据。每项数据单独记录读取日期，刷新成功不代表所有字段都已更新。'):t('卡片和金额由你手动填写；导入备份只恢复已保存的数据。每项数据单独记录日期。')}</Paragraph>
  <ul className="about-list"><li>{t('当前 ')}{cardCount}{t(' 条卡片记录。')}</li><li>{t('未采集的金额显示“待更新”，不会按零计算。')}</li><li>{t('不同国家与奖励计划分别统计，共用积分池仅计一次。')}</li><li>{t('年费、开卡日期和未知福利没有推测或补造。')}</li><li>{t('产品卡面取自发卡机构公开页面，未知卡种不使用错误图片代替。')}</li><li>{t('前端使用 React + Ant Design，保持默认蓝白主题。')}</li></ul>
  <Paragraph type="secondary">{t('数据与收藏保存在当前浏览器。使用“数据管理 → 导出备份”保存一份 JSON 文件。')}</Paragraph>
 </div>;
}
