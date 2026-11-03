# Cardybara · 卡疲扒拉

A local credit-card wallet, benefits organizer and experimental read-only bank connector, with an optional DeepSeek conversational assistant. React, Ant Design and Manifest V3.

**Status: developer alpha. Not published in the Chrome Web Store.** This release is intended for existing-wallet testers, not a complete onboarding experience for every cardholder.

## What works, and what is still limited

- Packaged wallet UI, three languages, card artwork and public benefit knowledge.
- Manual fee cycles, fee waivers/refunds, Credit usage and separate-currency metrics.
- Experimental bank-page collection for Amex US and HK, Chase, Bank of America, HSBC HK, Standard Chartered HK and, later, Citi US. It reads balance, statement amount, minimum payment and due date for every card, and rewards for Amex Membership Rewards and Chase Ultimate Rewards only. Other programmes show as not collected. Amex Canada is archived. Real evidence comes from one development account and is no guarantee for other users or products.
- Unknown amounts remain unknown. Yearless due dates are display-only. A no-payment message does not manufacture a numeric minimum or due date.
- Start with an empty wallet: choose a bank to read identifiable masked card headings. If discovery cannot confirm a card, add its name and last 4–5 digits yourself. No existing backup is required. Discovery is conservative and still requires real bank acceptance for each provider.
- AI chat currently requires the user's own optional loopback proxy/model configuration. There is no shared service, embedded developer key or included cloud quota. The wallet's manual features work without AI.

## One product, development first

`npm run dev` runs the same React application from `src/` on loopback, with source updates reflected in the browser. Its parser/agent API uses the same server handler as the built preview; there is no separate local product. It also runs the real collector without an installed extension: see "本地真实采集" in `docs/DEBUGGING.md`. `npm run debug:bank` replays bank samples and runs the shared collector/state-machine regressions without rebuilding or installing the extension.

Develop and verify locally first. Commit the source, then let PR CI run tests and produce the extension artifact. Use that exact CI artifact for the final Chrome-specific installation/permission/background/restart acceptance. Do not use manual copies into an installed extension directory as the ordinary development loop. `npm run preview:wallet` is only for inspecting a previously built frontend.

## Run and test

```sh
npm ci
npm run init:local
npm run build
npm run dev
```

Open http://127.0.0.1:8766. `init:local` creates an empty seed only when none exists. Add a card or connect a bank from the empty wallet. Backup import is optional; never upload personal backups to GitHub.

For optional AI, copy `.env.example` to `.env.local`, set your own model key, and explicitly allow your standalone extension's origin through `CARDYBARA_EXTENSION_ORIGINS`. The key remains in the local proxy. Enable any bank-data cloud parsing only after reviewing its consent settings.

```sh
npm run test:refresh
npm run check:agent
npm run check:coupons
npm run build:release
npm run check:release-package
```

Unzip the generated `release/cardybara-*.zip`. In a **new Chrome profile**, open `chrome://extensions`, enable **Developer mode**, select **Load unpacked**, and select the extracted folder containing `manifest.json`. Click the Cardybara toolbar icon, then **Open Cardybara**. ZIP files are testing artifacts, not one-click installers. Do not import an owner's backup during fresh-user acceptance. Do not uninstall or replace an existing personal wallet for this test.

## CI/CD

Pull requests and main commits run source/history hygiene checks, the combined tests, agent evals, coupon validation, production build and ZIP audit. The resulting ZIP and checksums are uploaded as Actions artifacts. A matching `v*` tag creates a **draft prerelease**, never a public release. Actual Chrome installation, fresh-user bank readback, restart and upgrade acceptance must pass for the exact ZIP checksum before `scripts/promote-release.mjs` will publish that draft. Simulated tests do not satisfy this gate. Chrome Web Store submission remains separate. No bank login or model key belongs in CI.

See [release readiness](docs/RELEASE.md), [privacy](PRIVACY.md), [security](SECURITY.md) and [store listing draft](docs/STORE_LISTING.md).

Public bank product images and source documents belong to their respective owners. This project is not affiliated with or endorsed by those banks. Preserve asset attributions and third-party notices.
