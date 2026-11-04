# Cardybara alpha privacy notice

Effective 2026-10-29. Maintainer contact: https://github.com/stl00/Cardybara/issues (general questions only; never post account data or keys). This notice describes the alpha implementation; a final publisher/store declaration is still required before store submission.

## Local data

The wallet can store card product names, masked tails, balances, billing fields, point observations, source dates, limited financial-page evidence, manual benefit usage and fee records. The extension uses local Chrome storage; wallet pages also use origin-local browser storage/IndexedDB for ledgers. The bundle starts empty and contains no developer account snapshot. Cloud browser sync is not used by the application.

Collection runs on supported bank pages in an existing user session. The reader does not read password values, cookies or authentication codes. Login and bank-required approval happen on the bank's own site. The connector does not pay, transfer money, redeem rewards, activate offers or change bank settings. Page structure, account association and partial dates can make collection incomplete.

## Optional model processing

Cloud parsing is optional and requires configured permissions and consent. When enabled, selected redacted financial excerpts may be sent to a chosen model service, including DeepSeek or Gemini through the configured route. Redaction is best effort and the excerpts remain sensitive. Review the consent UI and do not enable cloud parsing unless you accept that transfer.

The conversational assistant uses the configured local proxy to send chat text and necessary public card/benefit information and explicit manual benefit marks to DeepSeek. Its read-only tools do not expose bank balances or card numbers. It has no included shared API key. The local proxy key is stored in the user's private .env.local; direct-parser keys, when configured through the extension, are session-scoped. The optional loopback proxy is HTTP restricted to the user's own machine; provider requests use HTTPS.

## Reminders

Bill and benefit reminders are optional and off by default. Turning them on asks Chrome for notification permission. Reminders are decided on this device and shown only while a wallet page is open. They show a card or benefit name, and show an amount only if the user asks for that, because notifications can appear on a lock screen. Reminder settings and a list of reminders already shown stay in local browser storage. Nothing is sent to a server.

## Retention, exports and deletion

Local readings/ledgers remain until the user clears them or removes the relevant browser origin/extension. Task and evidence state is bounded and may be replaced during later runs. Exporting creates a sensitive local file under the user's control. Clearing the extension does not necessarily clear a separate website-origin wallet or exported files. Uninstalling may delete extension data; back up first.

No advertising, analytics telemetry or sale of data is implemented. GitHub CI uses synthetic/public fixtures only and receives no bank login or model credential. Providers process opted-in requests under their own policies; Cardybara does not claim that optional cloud processing is entirely local.
