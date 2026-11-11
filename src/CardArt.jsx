import React,{useEffect,useState} from 'react';
import {Typography} from 'antd';
import PictureOutlined from '@ant-design/icons/es/icons/PictureOutlined';
import {t,useI18n} from './i18n';
import {BankIdentity} from './Identity';
import {cardPresentation} from './productCatalog';
import {suggestionFor} from './productSuggestion';
import {useSuggestions} from './CardProductPicker.jsx';
const hint=(match,suggested)=>match.status==='matched'?'卡面待补全':suggested?'有 AI 建议的卡种，打开卡片确认':'未识别卡种，打开卡片可选择';
/** A product's own art file, cut to its crop when the issuer image holds more than the card. */
export function ArtImage({art,alt,height,onError}){
 const crop=art.crop,scale=crop?height/crop.height:1;
 return crop?<div className="art-crop" style={{position:'relative',overflow:'hidden',borderRadius:6,width:crop.width*scale,height,boxShadow:'0 7px 14px #00000020'}}><img src={`/assets/${art.file}`} alt={alt} loading="lazy" onError={onError} style={{position:'absolute',maxWidth:'none',width:crop.canvasWidth*scale,height:crop.canvasHeight*scale,left:-crop.x*scale,top:-crop.y*scale,objectFit:'fill',filter:'none',transform:'none'}}/></div>:<img src={`/assets/${art.file}`} alt={alt} loading="lazy" onError={onError}/>;
}
export default function CardArt({card,large=false}){
 useI18n();const suggestions=useSuggestions(),{art,match}=cardPresentation(card),[broken,setBroken]=useState(false);useEffect(()=>setBroken(false),[art?.file]);
 return <div className={`card-art ${large?'large':''}`}>{art?.file&&!broken?<ArtImage art={art} alt={t('{0} 产品卡面',[card.name])} height={large?190:140} onError={()=>setBroken(true)}/>:<div className="missing-art"><PictureOutlined/><span>{broken?t('图片暂时无法加载'):t(hint(match,match.status!=='matched'&&suggestionFor(card,suggestions)))}</span><Typography.Text type="secondary"><BankIdentity bank={card.bank}/></Typography.Text></div>}</div>;
}
