import React,{useState} from 'react';
import {Button,Flex,Modal,Typography} from 'antd';
import {t,useI18n} from './i18n';
import {GUIDE_STEPS,browserPlatform,installKind,isStandalone} from './webFirstLaunch.js';
const {Paragraph,Title}=Typography;
const INSTALL={
 ios:'iPhone / iPad（Safari）：点底部的“分享”，选“添加到主屏幕”。',
 android:'Android（Chrome）：打开菜单，点“安装应用”。',
 desktop:'电脑（Chrome / Edge）：点地址栏右侧的安装图标。'
};
// One screen of the guide. `platform` and `standalone` come from the browser; they are props so a test can pick any.
export function GuideStep({step,platform,standalone,onExport}){
 useI18n();const install=installKind({platform,standalone});
 if(step==='what')return <><Title level={4}>{t('这是什么')}</Title><Paragraph>{t('卡疲扒拉是一个在浏览器里运行的信用卡钱包，也可以当作应用使用。')}</Paragraph><Paragraph>{t('不需要账号、注册或银行登录。你手动添加自己的卡，就能看到每张卡的福利、额度和年费日。')}</Paragraph></>;
 if(step==='where')return <><Title level={4}>{t('数据保存在哪里')}</Title><Paragraph>{t('钱包数据只保存在你输入它的那个浏览器里，不上传，也不同步到其他设备。')}</Paragraph><Paragraph>{t('我们看不到你的钱包。换一部手机、换一个浏览器，或使用隐私窗口，打开的都是另一个空钱包。')}</Paragraph></>;
 if(step==='keep')return <><Title level={4}>{t('怎么保住数据')}</Title>
  {install?<Paragraph className="guide-install">{t('添加到主屏幕或安装成应用，数据更不容易丢。')}{' '}{t(INSTALL[install])}</Paragraph>:<Paragraph>{t('你正在以应用方式运行，不需要再安装。')}</Paragraph>}
  {install==='ios'&&<Paragraph>{t('iPhone 上的 Safari 可能清除约一周没打开的网站的数据，添加到主屏幕后不受此影响。')}</Paragraph>}
  <Paragraph>{t('清除网站数据会删除钱包。请经常在“数据管理”里导出备份。')}</Paragraph>
  <Button className="guide-export" onClick={onExport}>{t('现在导出备份')}</Button></>;
 return <><Title level={4}>{t('可选功能')}</Title>
  <Paragraph>{t('到期提醒需要你允许通知权限；在 iPhone 上还需要先添加到主屏幕。')}</Paragraph>
  <Paragraph>{t('用卡助手会把你的问题、对话前文、持有的卡种、积分估值、是否填了年费日和助手请求的钱包查询结果发送到 Cardybara 服务来回答；不含卡号、余额或账单。')}</Paragraph></>;
}
// The modal: skippable, closing it counts as finished, so the caller records "seen" in `onClose`.
export default function WebFirstLaunchGuide({open,onClose,onExport,platform=browserPlatform(),standalone=isStandalone()}){
 useI18n();const [i,setI]=useState(0),last=i===GUIDE_STEPS.length-1;
 const close=()=>{setI(0);onClose();};
 return <Modal className="web-guide" open={open} onCancel={close} centered title={`${i+1} / ${GUIDE_STEPS.length}`} destroyOnHidden
  styles={{body:{maxHeight:'60vh',overflowY:'auto'}}} width={440}
  footer={<Flex justify="space-between" gap={8}><Button className="guide-skip" type="text" onClick={close}>{last?t('关闭'):t('跳过')}</Button>
   <Flex gap={8}>{i>0&&<Button className="guide-back" onClick={()=>setI(i-1)}>{t('上一步')}</Button>}<Button className="guide-next" type="primary" onClick={()=>last?close():setI(i+1)}>{last?t('开始使用'):t('下一步')}</Button></Flex></Flex>}>
  <GuideStep step={GUIDE_STEPS[i]} platform={platform} standalone={standalone} onExport={onExport}/>
 </Modal>;
}
