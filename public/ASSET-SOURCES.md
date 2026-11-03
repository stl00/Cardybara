# Product artwork

Product artwork is used to identify the user's cards. Versions may differ from the physical cards. Cards without a retrieved image use locally authored, explicitly labeled schematic faces.

- American Express Gold, Platinum, Blue Cash Everyday and Hilton Aspire: https://www.americanexpress.com/us/credit-cards/ (public product artwork served by icm.aexp-static.com).
- Chase Sapphire Reserve: https://www.chase.com/sapphire-cards/personal/reserve
- HSBC Red and Premier: https://www.hsbc.com.hk/credit-cards/
- Product/interaction reference: https://maxworth.app/

No bank login credentials, full account numbers, cookies or authentication tokens are part of this application.

# Official card artwork research

All images fetched from public issuer websites; no authenticated banking pages accessed. Exact image URLs: `sources.json`.

## Ready clean artwork
- `chase-freedom-unlimited.png`: official Chase Freedom Unlimited, 1080×720 with transparent padding. Source page: https://www.chase.com/personal/credit-cards/freedom/unlimited
- `boa-customized-cash.png`: BOA Customized Cash Rewards Visa Signature, 500×315 transparent PNG. Source page: https://www.bankofamerica.com/credit-cards/products/cash-back-credit-card/
- `boa-atmos-summit.png`: BOA Atmos Rewards Summit Visa Infinite, 300×189 transparent PNG. Source page: https://newsroom.bankofamerica.com/content/newsroom/press-releases/2025/08/alaska-airlines-and-bank-of-america-present-a-new-premium-credit.html
- `amex-ca-platinum.png`: Canadian Platinum, 480×304 transparent PNG. Source page: https://www.americanexpress.com/en-ca/charge-cards/the-platinum-card/
- `amex-hk-platinum.png`: Hong Kong Platinum metal, 480×304 PNG. Source page: https://www.americanexpress.com/hk/en/charge-cards/platinum-card/
- `amex-ms-platinum.svg`: exact Morgan Stanley Platinum card official SVG, 248×158 with embedded bitmap. Source page: https://apply.americanexpress.com/amex-morgan-stanley%20-credit-cards/?page_url=38

## Official artwork available in centered promotional backgrounds
All files 1600×900. A CSS image viewport can clip to the card; no asset modifications were made.
- `hsbc-pulse-promo.jpg`: HSBC HK Pulse UnionPay Dual Currency Diamond. Card bounds about x440,y224,w720,h453. Source: https://www.hsbc.com.hk/credit-cards/products/unionpay-dual-currency-diamond/
- `hsbc-gold-promo.jpg`: HSBC HK Visa Gold. Same card bounds x440,y224,w720,h453. Source: https://www.hsbc.com.hk/credit-cards/products/visa-gold/
- `hsbc-easy-promo.jpg`: HSBC HK easy Visa Platinum (vertical). Bounds approx x574,y90,w452,h720. Source: https://www.hsbc.com.hk/credit-cards/products/visa-platinum/
- `hsbc-red-promo.jpg`: HSBC HK Red. Bounds about x440,y224,w720,h453. Source: https://www.hsbc.com.hk/credit-cards/products/
- `hsbc-premier-promo.jpg`: current HSBC HK Premier Mastercard, vertical. Bounds approx x574,y90,w452,h720. Source: https://www.hsbc.com.hk/credit-cards/products/

## Not resolved
- Amex Corporate: specific variant unknown. Official HK page exposes several Corporate variants, but no evidence identifies this user's variant. Keep existing marked illustrative card rather than misidentify it.
- HSBC clean transparent assets: official page assets are promotional JPGs; clipping these known official card regions is sufficient for accurate display.

{
  "chase-freedom-unlimited.png": "https://www.chase.com/content/dam/unified-assets/card-art/chase-freedom/freedom-unlimited/card_freedomUtld_V.png",
  "amex-ca-platinum.png": "https://icm.aexp-static.com/Internet/internationalcardshop/en_ca/images/cards/The_Platinum_Card.png",
  "amex-hk-platinum.png": "https://icm.aexp-static.com/Internet/internationalcardshop/en_hk/images/cards/chg_plat_metal_hk_480x304.png",
  "boa-customized-cash.png": "https://www1.bac-assets.com/credit-cards/spa-assets/images/assets-images-site-credit-cards-masthead-container-default-bofa_cshsigcm_v.png",
  "hsbc-pulse-promo.jpg": "https://www.hsbc.com.hk/content/dam/hsbc/hk/images/mass/credit-cards/tile-16-9/9358-hsbc-pulse-unionpay-grey-1600x900.jpg",
  "amex-ms-platinum.svg": "https://apply.americanexpress.com/wp-content/themes/openforum/morgan-stanley/images/chg_plat_metal_morgan.svg",
  "boa-atmos-summit.png": "https://newsroom.bankofamerica.com/content/dam/newsroom/images/press-releases/2025/082025_VECCHIARELLO_AS%20%20Atmos%20Summit%20Card.png",
  "hsbc-gold-promo.jpg": "https://www.hsbc.com.hk/content/dam/hsbc/hk/images/mass/credit-cards/tile-16-9/visa-gold-grey-pwsimg-7450.jpg",
  "hsbc-easy-promo.jpg": "https://www.hsbc.com.hk/content/dam/hsbc/hk/images/16-9/16952-hsbc-easy-visa-platinum-vertical-1600x900.jpg",
  "hsbc-red-promo.jpg": "https://www.hsbc.com.hk/content/dam/hsbc/hk/images/mass/credit-cards/tile-16-9/9358-hsbc-red-credit-card-grey-1600x900.jpg",
  "hsbc-premier-promo.jpg": "https://www.hsbc.com.hk/content/dam/hsbc/hk/images/mass/credit-cards/tile-16-9/14524-hsbc-premier-credit-card-white-bg-1600x900.jpg"
}
# Merchant and programme marks

Marks identify the service and belong to their owners; no endorsement is implied. An open-source icon package does not grant trademark rights: Simple Icons releases its project under CC0 but [asks users to seek the correct permissions](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md) for each brand.

Logos are bundled in `public/brand/logos/` and never fetched at runtime. A brand shows its logo only when `src/data/logos.json` marks it `approved`. Anything `forbidden` (terms require permission that has not been obtained) or `unverified` (no grant located) uses its category icon, and no file is bundled. This check was made on 2026-11-03 from public pages. It is not legal advice, and "unverified" does not mean the brand allows or forbids this use. "Candidate" is where a file could come from once approved.

| Brand | Status | Shown as | Candidate | Terms checked | Finding |
| --- | --- | --- | --- | --- | --- |
| DoorDash | unverified | category icon: delivery | simple-icons@16.36.0:doordash | https://www.doordash.com/terms/ | Official terms page returned HTTP 403 to the check; a secondary clause index lists "no license granted to use DoorDash trademarks". No brand guide located. |
| Uber | forbidden | category icon: ride-share | simple-icons@16.36.0:uber | https://www.uber.com/us/en/legal/general-terms-of-use/ | General terms require express written permission for marks beyond use incidental to the services; the brand guide applies its own acceptance terms, which were not accepted. |
| Lyft | forbidden | category icon: ride-share | simple-icons@16.36.0:lyft | https://www.lyft.com/press | A copy of the Lyft brand guide (v5.6, 2018) says the logo is typically authorized only for contracted partners; current official text not confirmed. |
| Apple | forbidden | category icon: entertainment | simple-icons@16.36.0:apple | https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html | Third parties may not use the Apple Logo without an express written trademark license. |
| Peloton | unverified | category icon: fitness | simple-icons@16.36.0:peloton | not located | Press page redirects away and the legal page returned 404 to the check. No published grant for third-party identifying use was located. |
| StubHub | unverified | category icon: entertainment | simple-icons@16.36.0:stubhub | not located | No published grant for third-party identifying use was located. |
| viagogo | unverified | category icon: entertainment | none | not located | No published grant for third-party identifying use was located. |
| Resy | unverified | category icon: dining | none | not located | No published grant for third-party identifying use was located. |
| Dunkin | unverified | category icon: dining | none | not located | No published grant for third-party identifying use was located. |
| Home Chef | unverified | category icon: dining | none | not located | No published grant for third-party identifying use was located. |
| lululemon | forbidden | category icon: shopping | none | https://shop.lululemon.com/help/legal/terms-of-use | Website terms warn that unauthorized use of its marks may violate trademark law; no grant for third-party use located. |
| Oura | forbidden | category icon: shopping | none | https://ouraring.com/guidelines-for-commercial-use | Commercial-use guidelines require written permission, which Oura may refuse or revoke (read from localized versions). |
| Walmart | forbidden | category icon: shopping | none | https://brandcenter.walmart.com/brand/trademarks | Brand center says its logos may only be used with prior written permission. |
| Disney | unverified | category icon: entertainment | none | not located | No published grant for third-party identifying use was located. |
| CLEAR | unverified | category icon: airport | none | not located | No published grant for third-party identifying use was located. |
| Priority Pass | unverified | category icon: lounge | none | not located | Conditions of use cover membership only. No published grant for third-party identifying use was located. |
| Plaza Premium | unverified | category icon: lounge | none | not located | No published grant for third-party identifying use was located. |
| Alaska Lounge | unverified | category icon: lounge | none | not located | No published grant for third-party identifying use was located. |
| Chase Sapphire Lounge | unverified | category icon: lounge | bundled:brand/banks/chase.svg | not located | No published grant for third-party identifying use was located. |
| The Edit | unverified | category icon: hotel | bundled:brand/banks/chase.svg | not located | No published grant for third-party identifying use was located. |
| The Shops at Chase | unverified | category icon: shopping | bundled:brand/banks/chase.svg | not located | No published grant for third-party identifying use was located. |
| Chase Ultimate Rewards | unverified | category icon: reward | bundled:brand/banks/chase.svg | not located | No published grant for third-party identifying use was located. |
| Amex Membership Rewards | unverified | category icon: reward | bundled:brand/banks/amex.svg | not located | No published grant for third-party identifying use was located. |
| Fine Hotels + Resorts | unverified | category icon: hotel | bundled:brand/banks/amex.svg | not located | No published grant for third-party identifying use was located. |
| The Hotel Collection | unverified | category icon: hotel | bundled:brand/banks/amex.svg | not located | No published grant for third-party identifying use was located. |
| HSBC RewardCash | unverified | category icon: reward | bundled:brand/banks/hsbc.png | https://www.hsbc.com/terms-and-conditions | No published grant for third-party identifying use was located. |
| MoneyBack | unverified | category icon: reward | none | not located | No published grant for third-party identifying use was located. |
| Morgan Stanley CashPlus | unverified | category icon: reward | none | not located | No published grant for third-party identifying use was located. |
| Hilton | forbidden | category icon: hotel | bundled:brand/banks/hilton.png | https://www.hilton.com/en/p/site-usage-agreement/ | Site usage agreement says its marks may not be used without prior express written consent; the media kit publishes logos without a usage grant. |
| IHG One Rewards | unverified | category icon: hotel | bundled:brand/banks/ihg.svg | not located | No published grant for third-party identifying use was located. |
| Marriott Bonvoy | unverified | category icon: hotel | simple-icons@16.36.0:marriott | not located | No published grant for third-party identifying use was located. |
| World of Hyatt | unverified | category icon: hotel | none | not located | No published grant for third-party identifying use was located. |
| Radisson Rewards | unverified | category icon: hotel | none | not located | No published grant for third-party identifying use was located. |
| ALL Accor | unverified | category icon: hotel | none | not located | No published grant for third-party identifying use was located. |
| Wyndham Rewards | unverified | category icon: hotel | none | not located | No published grant for third-party identifying use was located. |
| Renowned Hotels and Resorts | unverified | category icon: hotel | none | not located | No published grant for third-party identifying use was located. |
| United MileagePlus | unverified | category icon: airline | simple-icons@16.36.0:unitedairlines | not located | Terms page timed out during the check. No published grant for third-party identifying use was located. |
| Southwest | unverified | category icon: airline | simple-icons@16.36.0:southwestairlines | not located | No published grant for third-party identifying use was located. |
| Air Canada | unverified | category icon: airline | simple-icons@16.36.0:aircanada | not located | No published grant for third-party identifying use was located. |
| Delta SkyMiles | unverified | category icon: airline | simple-icons@16.36.0:delta | https://news.delta.com/delta-air-lines-logos-brand-guidelines | Publishes logo rules (no modification, approved colours) and a media contact, but no grant for third-party product use. |
| JetBlue TrueBlue | unverified | category icon: airline | simple-icons@16.36.0:jetblue | not located | No published grant for third-party identifying use was located. |
| Atmos Rewards | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| Aer Lingus AerClub | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| The British Airways Club | unverified | category icon: airline | simple-icons@16.36.0:britishairways | not located | No published grant for third-party identifying use was located. |
| Air France KLM Flying Blue | unverified | category icon: airline | simple-icons@16.36.0:airfrance | not located | No published grant for third-party identifying use was located. |
| Iberia Club | unverified | category icon: airline | simple-icons@16.36.0:iberia | not located | No published grant for third-party identifying use was located. |
| Singapore Airlines KrisFlyer | unverified | category icon: airline | simple-icons@16.36.0:singaporeairlines | not located | No published grant for third-party identifying use was located. |
| Virgin Atlantic Flying Club | unverified | category icon: airline | simple-icons@16.36.0:virginatlantic | not located | No published grant for third-party identifying use was located. |
| Cathay Asia Miles | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| HK Express | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| Aeromexico Rewards | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| ANA Mileage Club | unverified | category icon: airline | simple-icons@16.36.0:ana | not located | No published grant for third-party identifying use was located. |
| avianca lifemiles | unverified | category icon: airline | simple-icons@16.36.0:avianca | not located | No published grant for third-party identifying use was located. |
| Malaysia Airlines Enrich | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| EVA Infinity MileageLands | unverified | category icon: airline | none | not located | No published grant for third-party identifying use was located. |
| Qantas Frequent Flyer | unverified | category icon: airline | simple-icons@16.36.0:qantas | not located | No published grant for third-party identifying use was located. |
| Etihad Guest | unverified | category icon: airline | simple-icons@16.36.0:etihadairways | not located | No published grant for third-party identifying use was located. |

## Issuer marks already in the wallet

`public/brand/banks/` (sources in `public/brand/banks/sources.json`) predates this registry: American Express, Chase, HSBC, Standard Chartered, Bank of America, Hilton and IHG identify the user's own issuers and reward accounts in `BankMark`. Their terms have not been verified and they are awaiting an owner decision. They are not reused for other items.

## Category icons

Category icons come from `@ant-design/icons` (MIT). The airline icon is authored locally for this project.
