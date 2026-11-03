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