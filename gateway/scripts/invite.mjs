#!/usr/bin/env node
// Owner-only: makes a new invite code and prints the wrangler commands that store its SHA-256 digest.
// The code itself is printed once, here, for the owner to hand to the tester; it is never stored anywhere.
//   node gateway/scripts/invite.mjs <tester-id> [--daily-requests N] [--daily-tokens N]
//   node gateway/scripts/invite.mjs --revoke-hash <sha256-hex> <tester-id>
import {randomBytes,createHash} from 'node:crypto';
const args=process.argv.slice(2),take=flag=>{const i=args.indexOf(flag);if(i<0)return undefined;return args.splice(i,2)[1];};
const env=take('--env'),dailyRequests=take('--daily-requests'),dailyTokens=take('--daily-tokens'),revoke=take('--revoke-hash');
const id=args[0];
if(!id||!/^[a-z0-9-]{1,32}$/.test(id)){console.error('usage: invite.mjs <tester-id: a-z 0-9 - up to 32> [--daily-requests N] [--daily-tokens N] | --revoke-hash <hex> <tester-id>');process.exit(2);}
const where=`--binding INVITES --remote${env?' --env '+env:''}`;
const quote=s=>"'"+s.replace(/'/g,"'\\''")+"'";
const int=v=>v==null?undefined:(/^\d+$/.test(v)?Number(v):(console.error('not a whole number: '+v),process.exit(2)));
if(revoke){
 if(!/^[0-9a-f]{64}$/.test(revoke)){console.error('the hash is 64 hex characters (the part after invite: in the KV key)');process.exit(2);}
 const record={hash:revoke,id,status:'revoked'};
 console.log(`npx wrangler kv key put ${where} invite:${revoke} ${quote(JSON.stringify(record))}`);
 process.exit(0);
}
const code='cdy_'+randomBytes(32).toString('base64url');
const hash=createHash('sha256').update(code).digest('hex');
const record={hash,id,status:'active',...(int(dailyRequests)!=null?{dailyRequests:int(dailyRequests)}:{}),...(int(dailyTokens)!=null?{dailyTokens:int(dailyTokens)}:{})};
console.log('Invite code for '+id+' (give it to the tester; it is not stored anywhere):\n\n  '+code+'\n');
console.log('Store it (only the digest goes to Cloudflare):\n\n  npx wrangler kv key put '+where+' invite:'+hash+' '+quote(JSON.stringify(record))+'\n');
console.log('Revoke later:\n\n  node gateway/scripts/invite.mjs --revoke-hash '+hash+' '+id+'\n');
