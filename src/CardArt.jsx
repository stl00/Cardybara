import React,{useEffect,useState} from 'react';
import {Typography} from 'antd';
import PictureOutlined from '@ant-design/icons/es/icons/PictureOutlined';
import {t,useI18n} from './i18n';
import {BankIdentity} from './Identity';
import {cardPresentation} from './productCatalog';
export default function CardArt({card,large=false}){
 useI18n();const {art}=cardPresentation(card),[broken,setBroken]=useState(false);useEffect(()=>setBroken(false),[art?.file]);const height=large?190:140,crop=art?.crop,scale=crop?height/crop.height:1;
 return <div className={`card-art ${large?'large':''}`}>{art?.file&&!broken?(crop?<div className="art-crop" style={{position:'relative',overflow:'hidden',borderRadius:6,width:crop.width*scale,height,boxShadow:'0 7px 14px #00000020'}}><img src={`/assets/${art.file}`} alt={t('{0} 产品卡面',[card.name])} loading="lazy" onError={()=>setBroken(true)} style={{position:'absolute',maxWidth:'none',width:crop.canvasWidth*scale,height:crop.canvasHeight*scale,left:-crop.x*scale,top:-crop.y*scale,objectFit:'fill',filter:'none',transform:'none'}}/></div>:<img src={`/assets/${art.file}`} alt={t('{0} 产品卡面',[card.name])} loading="lazy" onError={()=>setBroken(true)}/>):<div className="missing-art"><PictureOutlined/><span>{broken?t('图片暂时无法加载'):t('卡面待补全')}</span><Typography.Text type="secondary"><BankIdentity bank={card.bank}/></Typography.Text></div>}</div>;
}
