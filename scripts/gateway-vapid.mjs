// Generates a VAPID key pair (P-256) for the gateway's Web Push reminders. Prints one JSON object to stdout:
// {"private": PKCS#8 base64url, "public": raw 65-byte point base64url}. Used only by scripts/gateway-set-vapid.sh,
// which pipes the private part straight to `wrangler secret put` and prints only the public part.
import {webcrypto} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const b64u=bytes=>Buffer.from(bytes).toString('base64url');
export async function generateVapid(){
 const pair=await webcrypto.subtle.generateKey({name:'ECDSA',namedCurve:'P-256'},true,['sign','verify']);
 return {private:b64u(await webcrypto.subtle.exportKey('pkcs8',pair.privateKey)),public:b64u(await webcrypto.subtle.exportKey('raw',pair.publicKey))};
}
if(process.argv[1]===fileURLToPath(import.meta.url))process.stdout.write(JSON.stringify(await generateVapid()));
