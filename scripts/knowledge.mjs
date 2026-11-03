#!/usr/bin/env node
import {queryKnowledge,groupKnowledge,getKnowledgeRule,inspectRuleRequirements,validateKnowledge} from '../src/knowledge.js';
const args=process.argv.slice(2),command=args.shift()||'help';
const usage='knowledge: validate | query [--product ID] [--category ID] [--scenario ID] [--programme ID] [--text TEXT] [--as-of YYYY-MM-DD] [--group category|scenario|programme|kind] | explain RULE_ID [--as-of DATE]';
try{
 if(command==='help'){console.log(usage);process.exit(0);}
 if(command==='validate'){const result=validateKnowledge();console.log(JSON.stringify(result,null,2));process.exit(result.valid?0:1);}
 const positional=command==='explain'?args.shift():null,opts={},mapping={'--product':'productId','--category':'category','--scenario':'scenarioId','--programme':'programmeId','--kind':'kind','--issuer':'issuer','--country':'country','--text':'text','--as-of':'asOf','--known-at':'knownAt'};let group;
 while(args.length){const flag=args.shift();if(flag==='--requires-enrollment'){opts.requiresEnrollment=true;continue;}if(flag==='--include-inactive'){opts.includeInactive=true;continue;}const value=args.shift();if(!value||value.startsWith('--'))throw Error(`Missing value for ${flag}`);if(flag==='--group')group=value;else if(mapping[flag])opts[mapping[flag]]=value;else throw Error(`Unknown flag ${flag}`);}
 if(command==='query'){const result=queryKnowledge(opts);console.log(JSON.stringify(group?{...result,rules:undefined,groups:groupKnowledge(result,group)}:result,null,2));}
 else if(command==='explain'){const rule=getKnowledgeRule(positional,opts);if(!rule)throw Error('Rule not found for that knowledge date');console.log(JSON.stringify({rule,requirements:inspectRuleRequirements(positional,{},opts)},null,2));}
 else throw Error(usage);
}catch(error){console.error(error.message);process.exitCode=1;}
