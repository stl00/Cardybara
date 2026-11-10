import json
p='evals/benefit-recall/golden.json'
s=open(p,encoding='utf-8').read()
P={"BP":"amex-us-us-business-platinum-card","BG":"amex-us-us-business-gold-card","CSRB":"chase-us-sapphire-reserve-for-business-credit-card","AC":"chase-us-air-canada-aeroplan-card","BOUND":"chase-us-marriott-bonvoy-boundless-credit-card","WF":"wells-fargo-us-autograph-journey-visa-card","INKCASH":"chase-us-ink-business-cash-credit-card"}
def Q(id,lang,typ,q,exp,why,rw,acc=None):
    x={"id":id,"portfolio":"dev-business","lang":lang,"type":typ,"question":q,"expected":exp}
    if acc:x["acceptable"]=acc
    x["rationale"]=why;x["rewrite"]=rw;return x
new=[
Q("db-hiring-en","en","paraphrase","We need to post a few job ads. Does any card help with that?",["BP:indeed","CSRB:ziprecruiter"],"Indeed and ZipRecruiter are job-posting sites; both credits apply.",[{"query":"job ads hiring 招聘","scenarioId":"shopping","category":"credit"}]),
Q("db-hiring-hans","zh-Hans","paraphrase","公司招人发职位，能报销吗？",["BP:indeed","CSRB:ziprecruiter"],"Recruiting sites Indeed and ZipRecruiter.",[{"query":"招聘 职位 发布","category":"credit"}]),
Q("db-hiring-hant","zh-Hant","colloquial","請人登招聘廣告有冇回贈？",["BP:indeed","CSRB:ziprecruiter"],"Same as db-hiring-hans, Hong Kong wording.",[{"query":"招聘 廣告","category":"credit"}]),
Q("db-website-en","en","paraphrase","I'm setting up an online store website. Any card perks?",["BG:squarespace"],"Squarespace builds websites and online stores.",[{"query":"website online store builder","scenarioId":"shopping"}]),
Q("db-website-hans","zh-Hans","paraphrase","做公司网站的费用能抵吗？",["BG:squarespace"],"Squarespace is a website builder.",[{"query":"网站 建站 抵扣","scenarioId":"shopping","category":"credit"}]),
Q("db-design-en","en","paraphrase","Do I get anything back on design software like Photoshop?",["BP:adobe"],"Photoshop is Adobe software.",[{"query":"design software Photoshop","scenarioId":"shopping"}]),
Q("db-ai-hans","zh-Hans","paraphrase","公司订 AI 工具有补贴吗？",["BG:chatgpt"],"ChatGPT Business is an AI tool subscription.",[{"query":"AI 工具 订阅","scenarioId":"shopping","category":"credit"}]),
Q("db-email-en","en","paraphrase","credit for our business email and office suite",["CSRB:google-workspace"],"Google Workspace provides business email and office apps.",[{"query":"business email office suite","scenarioId":"shopping","category":"credit"}]),
Q("db-laptop-hant","zh-Hant","paraphrase","公司買手提電腦有冇優惠？",["BP:dell"],"Dell sells laptops; 手提電腦 is a laptop.",[{"query":"手提電腦 電腦","scenarioId":"shopping"}]),
Q("db-phone-en","en","paraphrase","Can my monthly phone bill be reimbursed?",["BP:wireless"],"Wireless credit for a US wireless carrier bill.",[{"query":"phone bill wireless","category":"credit"}]),
Q("db-phone-hans","zh-Hans","colloquial","每个月的手机话费有抵扣吗？",["BP:wireless"],"Same as db-phone-en.",[{"query":"手机话费 无线通信","category":"credit"}]),
Q("db-phone-hant","zh-Hant","colloquial","電話費可唔可以回贈？",["BP:wireless"],"Same as db-phone-en, Hong Kong wording.",[{"query":"電話費 回贈","category":"credit"}]),
Q("db-airline-en","en","paraphrase","Which cards give me money back when I buy from an airline?",["AC:air-canada-credit","BOUND:airline-credit","WF:airline-credit","BP:airline-fee"],"Credits for spending with airlines: Air Canada, Boundless and Wells Fargo airline credits, and the airline fee credit.",[{"query":"airline purchase credit","scenarioId":"travel"}],acc=["CSRB:travel"]),
Q("db-airline-hans","zh-Hans","paraphrase","在航空公司官网买东西有返还吗？",["AC:air-canada-credit","BOUND:airline-credit","WF:airline-credit","BP:airline-fee"],"Same as db-airline-en.",[{"query":"航空公司 消费 抵扣","scenarioId":"travel","category":"credit"}],acc=["CSRB:travel"]),
Q("db-aircanada-hant","zh-Hant","direct","加拿大航空機票有冇抵扣？",["AC:air-canada-credit"],"Air Canada credit.",[{"query":"加拿大航空 Air Canada","programme":"Air Canada"}]),
Q("db-software-en","en","paraphrase","What about the software subscriptions my company pays for?",["BP:adobe","BG:chatgpt","BG:squarespace","CSRB:google-workspace"],"Adobe, ChatGPT, Squarespace and Google Workspace are software subscriptions. Hiring sites are services, acceptable.",[{"query":"software subscriptions","scenarioId":"shopping","category":"credit"}],acc=["BP:indeed","CSRB:ziprecruiter"]),
Q("db-grocery-en","en","paraphrase","Any perks for grocery delivery to the office?",["INKCASH:instacart","CSRB:doordash-promo"],"Instacart delivers groceries; the DoorDash promo covers grocery and retail orders. Walmart+ includes delivery, acceptable.",[{"query":"grocery delivery","scenarioId":"shopping"}],acc=["BG:walmart-plus","BG:flexible-business"]),
Q("db-absent-gym-en","en","absent","gym membership credit?",[],"No fitness rule for these cards in the current knowledge base.",[{"query":"gym membership","scenarioId":"fitness"}]),
]
d=json.loads(s)
assert not {q['id'] for q in d['questions']}&{q['id'] for q in new}
lines=s.split('\n')
k=next(i for i,l in enumerate(lines) if l.strip().startswith('"us-everyday":'))
lines[k]=lines[k].rstrip()+','
lines.insert(k+1,'    "dev-business": '+json.dumps(P,ensure_ascii=False))
s='\n'.join(lines)
end=s.rindex('\n  ]')
s=s[:end]+',\n\n'+',\n'.join('    '+json.dumps(q,ensure_ascii=False) for q in new)+s[end:]
json.loads(s);open(p,'w',encoding='utf-8').write(s)
print(len(json.loads(s)['questions']))
