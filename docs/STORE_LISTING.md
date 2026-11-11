# Draft Chrome Web Store listing — not submitted

Name: Cardybara · 卡疲扒拉

Single purpose: organize a user's credit-card wallet and related billing/reward/benefit records, with optional read-only collection from supported bank pages.

Short description: Local card wallet and benefits organizer with experimental read-only bank-page refresh.

Privacy policy draft URL: https://github.com/stl00/Cardybara/blob/main/PRIVACY.md
Support: https://github.com/stl00/Cardybara/issues (no personal financial data)

Bank permissions enable the built-in reader on the declared bank sites only. scripting executes packaged readers; storage persists local wallet/task data; alarms closes timed-out tasks and wakes the background worker when a reminder is due. notifications is optional, off by default and requested only when the user turns on bill and benefit reminders in Settings; the background worker uses it to show local reminders while Chrome is running, including with the wallet page closed, and sends nothing anywhere. Optional model/loopback permissions are for explicitly configured model processing. The optional Cardybara gateway host is requested only when the user saves an invite code; chat content and card-type recognition then pass through the gateway to the model provider and are not stored by the gateway; model-assisted bank parsing is off in that mode. No payment, transfer, authentication-cookie access or remote executable code is requested.

Before submitting: complete new-user onboarding, standalone AI setup, publisher contact/identity, actual permission/data declarations, synthetic-data screenshots and reviewer instructions. Disclose financial data handling even when local. Do not claim complete seven-bank support or provide personal bank credentials for review.
