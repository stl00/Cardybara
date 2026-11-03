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

Logos are bundled locally and never fetched at runtime. **On 2026-11-03 the owner decided to show a logo for every brand below. This is the project owner's decision, not permission from any brand.** No brand has granted permission. "Terms" records what the check found on public pages that day: `requires-permission` means published terms found require permission that has not been obtained; `unverified` means no grant could be located, which does not mean the brand allows or forbids this use. This is not legal advice. If a brand objects, set its entry to `unapproved` in `src/data/logos.json` and remove its file; the item then shows its category icon.

Files from official sites are the site's own favicon or touch icon, resized to at most 64 pixels; some are low resolution. Some programmes show their operator's mark, and are labelled as that operator: Chase (The Edit, The Shops at Chase, Chase Sapphire Lounge, Chase Ultimate Rewards, Renowned Hotels and Resorts), American Express (Membership Rewards, Fine Hotels + Resorts, The Hotel Collection), HSBC (RewardCash), Alaska Airlines (Atmos Rewards) and Air France (Flying Blue).

| Brand | Terms | File | Source | Terms page | Finding |
| --- | --- | --- | --- | --- | --- |
| DoorDash | unverified | brand/logos/doordash.svg | simple-icons@16.36.0:doordash | https://www.doordash.com/terms/ | Official terms page returned HTTP 403 to the check; a secondary clause index lists "no license granted to use DoorDash trademarks". No brand guide located. |
| Uber | requires-permission | brand/logos/uber.svg | simple-icons@16.36.0:uber | https://www.uber.com/us/en/legal/general-terms-of-use/ | General terms require express written permission for marks beyond use incidental to the services; the brand guide applies its own acceptance terms, which were not accepted. |
| Uber Eats | requires-permission | brand/logos/uber-eats.svg | simple-icons@16.36.0:ubereats | https://www.uber.com/us/en/legal/general-terms-of-use/ | Same Uber terms: express written permission is required for marks beyond use incidental to the services. |
| Lyft | requires-permission | brand/logos/lyft.svg | simple-icons@16.36.0:lyft | https://www.slideshare.net/slideshow/design_lyft_brand_guidelines_march2018-pdf/283233341 | A third-party copy of the Lyft brand guide (v5.6, 2018) says the logo is typically authorized only for contracted partners; current official text not confirmed. |
| Apple | requires-permission | brand/logos/apple.svg | simple-icons@16.36.0:apple | https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html | Third parties may not use the Apple Logo without an express written trademark license. |
| Peloton | unverified | brand/logos/peloton.svg | simple-icons@16.36.0:peloton | not located | Press page redirects away and the legal page returned 404 to the check. No published grant for third-party identifying use was located. |
| StubHub | unverified | brand/logos/stubhub.svg | simple-icons@16.36.0:stubhub | not located | No published grant for third-party identifying use was located. |
| viagogo | unverified | brand/logos/viagogo.png | https://www.viagogo.com/apple-touch-icon.png | not located | No published grant for third-party identifying use was located. |
| Resy | unverified | brand/logos/resy.png | https://resy.com/images/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Dunkin | unverified | brand/logos/dunkin.svg | https://www.dunkindonuts.com/brands/dun/logo.svg | not located | No published grant for third-party identifying use was located. |
| Home Chef | unverified | brand/logos/home-chef.png | https://www.homechef.com (site favicon) | not located | No published grant for third-party identifying use was located. |
| lululemon | unverified | brand/logos/lululemon.png | https://shop.lululemon.com/favicon.ico | https://shop.lululemon.com/help/legal/terms-of-use | Website terms bar framing its marks without written consent and warn that unauthorized use may violate trademark law; no grant located and no rule on identifying use. |
| Oura | requires-permission | brand/logos/oura.png | https://ouraring.com/assets/icons/apple-touch-icon.png | https://ouraring.com/guidelines-for-commercial-use | Commercial-use guidelines require written permission, which Oura may refuse or revoke (read from localized versions). |
| Walmart | requires-permission | brand/logos/walmart.png | https://www.walmart.com/apple-touch-icon.png | https://brandcenter.walmart.com/brand/trademarks | Brand center says its logos may only be used with prior written permission. |
| Disney | unverified | brand/logos/disney.png | https://www.disney.com (site favicon) | not located | No published grant for third-party identifying use was located. |
| CLEAR | unverified | brand/logos/clear.png | https://www.clearme.com (site favicon) | not located | No published grant for third-party identifying use was located. |
| Priority Pass | unverified | brand/logos/priority-pass.png | https://www.prioritypass.com (site icon) | not located | Conditions of use cover membership only. No published grant for third-party identifying use was located. |
| Plaza Premium | unverified | brand/logos/plaza-premium.png | https://assets.plazapremiumlounge.com/images/favicon-16.png | not located | No published grant for third-party identifying use was located. |
| Alaska Lounge | unverified | brand/logos/alaska-lounge.png | https://resource.alaskaair.net/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Chase Sapphire Lounge | unverified | brand/banks/chase.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| The Edit | unverified | brand/banks/chase.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| The Shops at Chase | unverified | brand/banks/chase.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| Chase Ultimate Rewards | unverified | brand/banks/chase.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| Amex Membership Rewards | unverified | brand/banks/amex.svg | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| Fine Hotels + Resorts | unverified | brand/banks/amex.svg | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| The Hotel Collection | unverified | brand/banks/amex.svg | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| HSBC RewardCash | unverified | brand/banks/hsbc.png | bundled: public/brand/banks/sources.json | https://www.hsbc.com/terms-and-conditions | No published grant for third-party identifying use was located. |
| MoneyBack | unverified | brand/logos/moneyback.png | https://www.moneyback.com.hk/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Morgan Stanley CashPlus | unverified | brand/logos/morgan-stanley-cashplus.png | https://www.morganstanley.com (site favicon) | not located | No published grant for third-party identifying use was located. |
| Hilton | requires-permission | brand/banks/hilton.png | bundled: public/brand/banks/sources.json | https://www.hilton.com/en/p/site-usage-agreement/ | Site usage agreement says its marks may not be used without prior express written consent; the media kit publishes logos without a usage grant. |
| IHG One Rewards | unverified | brand/banks/ihg.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| Marriott Bonvoy | unverified | brand/logos/marriott.svg | simple-icons@16.36.0:marriott | not located | No published grant for third-party identifying use was located. |
| World of Hyatt | unverified | brand/logos/hyatt.png | https://www.hyatt.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Radisson Rewards | unverified | brand/logos/radisson.png | https://www.radissonhotels.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| ALL Accor | unverified | brand/logos/accor.png | https://all.accor.com (site favicon) | not located | No published grant for third-party identifying use was located. |
| Wyndham Rewards | unverified | brand/logos/wyndham.svg | https://www.wyndhamhotels.com/content/dam/wyndham/brand-icons/whr.svg | not located | No published grant for third-party identifying use was located. |
| Renowned Hotels and Resorts | unverified | brand/banks/chase.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| United MileagePlus | unverified | brand/logos/united.svg | simple-icons@16.36.0:unitedairlines | not located | Terms page timed out during the check. No published grant for third-party identifying use was located. |
| Southwest | unverified | brand/logos/southwest.svg | simple-icons@16.36.0:southwestairlines | not located | No published grant for third-party identifying use was located. |
| Air Canada | unverified | brand/logos/air-canada.svg | simple-icons@16.36.0:aircanada | not located | No published grant for third-party identifying use was located. |
| Delta SkyMiles | unverified | brand/logos/delta.svg | simple-icons@16.36.0:delta | https://news.delta.com/delta-air-lines-logos-brand-guidelines | Publishes logo rules (no modification, approved colours) and a media contact, but no grant for third-party product use. |
| JetBlue TrueBlue | unverified | brand/logos/jetblue.svg | simple-icons@16.36.0:jetblue | not located | No published grant for third-party identifying use was located. |
| Atmos Rewards | unverified | brand/logos/alaska-lounge.png | https://resource.alaskaair.net/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Aer Lingus AerClub | unverified | brand/logos/aer-lingus.png | https://www.aerlingus.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| The British Airways Club | unverified | brand/logos/british-airways.svg | simple-icons@16.36.0:britishairways | not located | No published grant for third-party identifying use was located. |
| Air France KLM Flying Blue | unverified | brand/logos/flying-blue.svg | simple-icons@16.36.0:airfrance | not located | No published grant for third-party identifying use was located. |
| Iberia Club | unverified | brand/logos/iberia.svg | simple-icons@16.36.0:iberia | not located | No published grant for third-party identifying use was located. |
| Singapore Airlines KrisFlyer | unverified | brand/logos/singapore-airlines.svg | simple-icons@16.36.0:singaporeairlines | not located | No published grant for third-party identifying use was located. |
| Virgin Atlantic Flying Club | unverified | brand/logos/virgin-atlantic.svg | simple-icons@16.36.0:virginatlantic | not located | No published grant for third-party identifying use was located. |
| Cathay Asia Miles | unverified | brand/logos/cathay.png | https://www.cathaypacific.com/content/dam/header-footer-lrp/cx-web-clip-icon.png | not located | No published grant for third-party identifying use was located. |
| HK Express | unverified | brand/logos/hk-express.png | https://www.hkexpress.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Aeromexico Rewards | unverified | brand/logos/aeromexico.png | https://aeromexico.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| ANA Mileage Club | unverified | brand/logos/ana.svg | simple-icons@16.36.0:ana | not located | No published grant for third-party identifying use was located. |
| avianca lifemiles | unverified | brand/logos/avianca.svg | simple-icons@16.36.0:avianca | not located | No published grant for third-party identifying use was located. |
| Malaysia Airlines Enrich | unverified | brand/logos/malaysia-airlines.png | https://www.malaysiaairlines.com (site favicon) | not located | No published grant for third-party identifying use was located. |
| EVA Infinity MileageLands | unverified | brand/logos/eva-air.png | https://www.evaair.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Qantas Frequent Flyer | unverified | brand/logos/qantas.svg | simple-icons@16.36.0:qantas | not located | No published grant for third-party identifying use was located. |
| Etihad Guest | unverified | brand/logos/etihad.svg | simple-icons@16.36.0:etihadairways | not located | No published grant for third-party identifying use was located. |

## Issuer marks

`public/brand/banks/` (sources in `public/brand/banks/sources.json`) holds American Express, Chase, HSBC, Standard Chartered, Bank of America, Hilton and IHG. They identify the user's own issuers and reward accounts in `BankMark`, and the owner's decision above covers them. Their terms have not been verified, except that Hilton's site usage agreement requires prior written consent.

## Category icons

Items that name no single brand show a category icon from `@ant-design/icons` (MIT). The airline icon is authored locally for this project.
