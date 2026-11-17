# Cardybara alpha privacy notice

Effective 2026-10-29. Maintainer contact: https://github.com/stl00/Cardybara/issues (general questions only; never post account data or keys). This notice describes the alpha implementation; a final publisher/store declaration is still required before store submission.

## Local data

The wallet can store card product names, masked tails, balances, billing fields, point observations, source dates, limited financial-page evidence, manual benefit usage and fee records. The extension uses local Chrome storage; wallet pages also use origin-local browser storage/IndexedDB for ledgers. The bundle starts empty and contains no developer account snapshot. Cloud browser sync is not used by the application today; the optional account sync described below applies only once its screens ship, and is off until you turn it on.

Collection runs on supported bank pages in an existing user session. The reader does not read password values, cookies or authentication codes. Login and bank-required approval happen on the bank's own site. The connector does not pay, transfer money, redeem rewards, activate offers or change bank settings. Page structure, account association and partial dates can make collection incomplete.

## Optional model processing

Cloud parsing is optional and requires configured permissions and consent. When enabled, selected redacted financial excerpts may be sent to a chosen model service, including DeepSeek or Gemini through the configured route. Redaction is best effort and the excerpts remain sensitive. Review the consent UI and do not enable cloud parsing unless you accept that transfer.

The conversational assistant can use the Cardybara hosted service with an invite code: chat content and card-type recognition then pass through the Cardybara gateway to the model provider (DeepSeek) and are not stored by the gateway; model-assisted bank parsing is off in that mode, so bank figures never go through the gateway, which logs only the invite code's id, the time, token counts and status. The invite code is kept only in the extension's local storage and sent only to the gateway. With an own key instead, requests go straight from the extension to the provider. See docs/GATEWAY.md.

The conversational assistant uses the configured local proxy to send chat text and necessary public card/benefit information and explicit manual benefit marks to DeepSeek. Its read-only tools do not expose bank balances or card numbers. It has no included shared API key. The local proxy key is stored in the user's private .env.local; direct-parser keys, when configured through the extension, are session-scoped. The optional loopback proxy is HTTP restricted to the user's own machine; provider requests use HTTPS.

## Reminders

Bill and benefit reminders are optional and off by default. Turning them on asks Chrome for notification permission. Reminders are decided on this device. So that they can arrive with the wallet page closed while Chrome is running, the wallet page saves a short plan in the extension's local storage for its background worker: reminder ids, card and benefit names, dates and notification wording, and a bill amount only if the user asks for amounts. Reminders show a card or benefit name, and show an amount only if the user asks for that, because notifications can appear on a lock screen. The plan is replaced whenever the wallet page syncs and removed when reminders are turned off. Reminder settings and a list of reminders already shown stay in local browser storage, and uninstalling the extension removes them. Nothing is sent to a server.

## Web version

The web version of the wallet keeps its data in the browser where it was entered (browser storage on this device); it is not uploaded or synced to other devices unless you create an account and turn on sync (see above). Without sync, the only thing it uploads is the questions asked to the conversational assistant, with the same content described above: earlier turns of the conversation, card products, point valuations, whether each card has an annual fee date and the wallet lookups the assistant asks for; never card numbers, balances or statements. Cards and amounts in the web version are entered by hand; bank reading exists only in the desktop Chrome extension. A browser may clear the data of a site that is not on the Home Screen, so export a backup regularly. 

## Optional account and wallet sync (web version and extension, when released)

An account is optional. Without one, or with sync off, the wallet uploads nothing and works exactly as above. The account screens have not shipped yet; this section is the boundary they must keep, and `npm run check:web` and its tests enforce it where they can.

- **What the server stores** (only after you create an account and turn sync on): a passkey public key (never a private key, and there is no email or phone number), session records, one readable copy of the wallet document (cards, statement fields you or the bank page produced, fee dates, benefit and cost records, settings), and, if you turn on web push, the push subscription and fire times.
- **What it never stores:** bank passwords, cookies, one-time codes, bank page contents or page evidence. These stay on the bank page in your own browser; the sync body is checked against the wallet document's fields and anything else is rejected.
- **Not end-to-end encrypted.** The copy is readable on the server so that devices can merge it. The database is encrypted at rest and every request is limited to the signed-in user's own rows. The operator, who owns the Cloudflare account that hosts the database, can technically read it; the operator does not read user rows except at a user's request for a named issue, logs keep route, status, a hashed user id and size but never wallet content or credentials, and no analytics, cookies or third-party requests are used.
- **Export and deletion.** You can export everything the server holds for you, sign out (local data stays), or delete the account, which deletes every server row for it, including sessions and passkeys, and keeps the local wallet. Losing every passkey loses access to the server copy; add a second passkey.

## Retention, exports and deletion

Local readings/ledgers remain until the user clears them or removes the relevant browser origin/extension. Task and evidence state is bounded and may be replaced during later runs. Exporting creates a sensitive local file under the user's control. Clearing the extension does not necessarily clear a separate website-origin wallet or exported files. Uninstalling may delete extension data; back up first.

No advertising, analytics telemetry or sale of data is implemented. GitHub CI uses synthetic/public fixtures only and receives no bank login or model credential. Providers process opted-in requests under their own policies; Cardybara does not claim that optional cloud processing is entirely local.
