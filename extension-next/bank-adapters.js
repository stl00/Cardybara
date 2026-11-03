// Declarative scopes, not claims of live coverage. Each bank/page needs a dated fixture and acceptance run.
export const BANK_ADAPTERS={
 'Amex US':{programmes:['Membership Rewards','Hilton Honors','Reward Dollars'],sections:['overview','rewards','benefits','offers','activity'],moneyEvidence:'historical'},
 'Amex HK':{programmes:['Membership Rewards'],sections:['overview','rewards','offers','activity'],moneyEvidence:'live-2026-10-23'},
 'Amex CA':{programmes:['Membership Rewards'],sections:['overview','rewards','offers','activity'],moneyEvidence:'unverified'},
 Chase:{programmes:['Ultimate Rewards','IHG One Rewards','MileagePlus Miles'],sections:['overview','rewards','offers','activity'],moneyEvidence:'historical-four-cards'},
 BOA:{programmes:['Atmos Rewards','Cash Rewards'],sections:['overview','rewards','offers','activity'],moneyEvidence:'historical'},
 'HSBC HK':{programmes:['RewardCash','獎賞錢','奖赏钱'],sections:['overview','rewards','offers','activity'],moneyEvidence:'live-2026-10-23'},
 'SC HK':{programmes:['Asia Miles','亞洲萬里通','亚洲万里通','CashBack'],sections:['overview','rewards','offers','activity'],moneyEvidence:'unverified'}
};
export const canonicalProgramme=raw=>{const key=raw.replace(/[®™]/g,'').replace(/\s+/g,' ').trim();return ({'美國運通積分計劃':'membership rewards','美国运通积分计划':'membership rewards','美國運通積分':'membership rewards','ultimate rewards points':'ultimate rewards','ihg one rewards points':'ihg one rewards','mileageplus miles':'mileageplus',mr:'membership rewards',ur:'ultimate rewards','獎賞錢':'rewardcash','奖赏钱':'rewardcash','亞洲萬里通':'asia miles','亚洲万里通':'asia miles'})[key.toLowerCase()]||key.toLowerCase();};
