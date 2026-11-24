// One place for the sync boundary the sync tests hold every captured /v2/account wallet body to (stl00/Cardybara#420, #411, #547).
// The sections the gateway schema lists, plus what the client's document also carries today: the format version and the
// bankReadings and cardMerges sections (src/walletDocument.js).
import assert from 'node:assert/strict';
import {WALLET_SECTIONS} from '../../gateway/src/walletSchema.js';
import {checkAccountBody} from '../../scripts/check-web.mjs';

export const ALLOWED_SECTIONS = [...Object.keys(WALLET_SECTIONS), 'formatVersion', 'bankReadings', 'cardMerges'];

// A body sent to the wallet route (a PUT) must stay inside the wallet document and carry no credential-shaped key.
export function assertWalletBody(body, label = 'wallet body') {
  assert.deepEqual(checkAccountBody(body, {allowed: ALLOWED_SECTIONS}), [], `${label} leaves the wallet document`);
}

// Wraps a gateway fetch so every PUT to the wallet route is checked as it is sent. The sign-up, sign-in and password
// routes carry a password by design and are not checked here.
export function guardWalletPuts(fetchFn, prefix = '/v2/account/wallet') {
  return (url, init = {}) => {
    if (String(url).split('?')[0].endsWith(prefix) && (init.method || 'GET') === 'PUT') assertWalletBody(init.body, `PUT ${prefix} body`);
    return fetchFn(url, init);
  };
}
