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
- `chase-freedom-rise.png`: official Chase Freedom Rise without the promotional ribbon. Source page: https://www.chase.com/personal/credit-cards/freedom/rise
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
- Chase Slate Edge: the available official image carries a promotional ribbon; no clean official source found yet.
- Amex Corporate: specific variant unknown. Official HK page exposes several Corporate variants, but no evidence identifies this user's variant. Keep existing marked illustrative card rather than misidentify it.
- HSBC clean transparent assets: official page assets are promotional JPGs; clipping these known official card regions is sufficient for accurate display.

{
  "chase-freedom-rise.png": "https://www.chase.com/content/dam/unified-assets/card-art/chase-freedom/freedom-rise/card_freedomRise_V.png",
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

## Issuer card art, Amex US (checked 2026-11-11, #230)

Each image was read without login from the product's own public American Express page (curl, no browser): the schema.org `CreditCard` (a FinancialProduct) image (or `WebPage` primaryImageOfPage) whose URL is that page on personal-card pages, and the page's `og:image` meta tag on business-card pages. Files are stored unmodified as `catalog-<sha256(image URL)[:16]>.png`. Terms: American Express's [Website Rules and Regulations](https://www.americanexpress.com/us/legal-disclosures/website-rules-and-regulations.html) say site content is protected by copyright and may not be copied, displayed or reproduced without express written consent, and that the marks shown on the site belong to American Express or its licensors; no grant was found, so every row is `requires-permission`. Showing them follows the owner's request in #230 and is the owner's decision, not permission from American Express. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. The Green Card's page now redirects to the all-cards list; its image is the one that list's data still names for `/us/credit-cards/card/green/`. Not filled: Schwab Platinum (American Express publishes only its cardmember agreement PDF; no public product page found).

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Blue Business Cash Card | assets/catalog-c1b225ff00b76970.png | https://www.americanexpress.com/en-us/business/credit-cards/blue-business-cash/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/blue-business-cash.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Blue Business Plus Credit Card | assets/catalog-0e6425cb14be23bc.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/american-express-blue-business-plus-credit-card-amex/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/blue-business-plus.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Blue Cash Preferred Card | assets/catalog-d74106c987556a79.png | https://www.americanexpress.com/us/credit-cards/card/blue-cash-preferred/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000264_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Business Gold Card | assets/catalog-a66ecab22883b6ce.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/american-express-business-gold-card-amex/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/business-gold.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Business Green Rewards Card | assets/catalog-5bba3af538f4ab02.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/american-express-business-green-card-amex/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/business-green-rewards.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Business Platinum Card | assets/catalog-b83200a169fc795d.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/american-express-business-platinum-credit-card-amex/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/business-platinum.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Blue American Express Card | assets/catalog-13470a44dffb21a6.png | https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-blue-american-express-card/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000267_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Gold American Express Card | assets/catalog-069d3a8d8a32c25b.png | https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-gold-american-express-card/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000268_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Gold Business Card | assets/catalog-d38f1a19dcaa28ba.png | https://www.americanexpress.com/en-us/business/credit-cards/delta-skymiles-gold/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/gold-delta-skymiles-business.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Platinum American Express Card | assets/catalog-9feb5918e055cec3.png | https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-platinum-american-express-card/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000269_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Platinum Business Card | assets/catalog-01d7f07cac5a91eb.png | https://www.americanexpress.com/en-us/business/credit-cards/delta-skymiles-platinum/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/platinum-delta-skymiles-business.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Reserve American Express Card | assets/catalog-57d69282dbbe7e01.png | https://www.americanexpress.com/us/credit-cards/card/delta-skymiles-reserve-american-express-card/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/category/cardarts/delta-reserve.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Delta SkyMiles Reserve Business Card | assets/catalog-454ad869ac06a591.png | https://www.americanexpress.com/en-us/business/credit-cards/delta-skymiles-reserve/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/delta-reserve-business.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Graphite Business Cash Unlimited Card | assets/catalog-53b0eda1c4f886ed.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/graphite-business-cash-unlimited-card/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/graphite.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Green Card | assets/catalog-65536a9ee84b6885.png | https://www.americanexpress.com/us/credit-cards/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000274_480x304_straight_withname.png | schema.org WebPage primaryImageOfPage for /us/credit-cards/card/green/ | unmodified | 2026-11-11 | requires-permission |
| Hilton Honors American Express Business Card | assets/catalog-840796e917265353.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/hilton-honors/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/hilton-honors.png | og:image | unmodified | 2026-11-11 | requires-permission |
| Hilton Honors American Express Card | assets/catalog-e21cb7d4d6a70637.png | https://www.americanexpress.com/us/credit-cards/card/hilton-honors/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000327_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Hilton Honors American Express Surpass Card | assets/catalog-1bf150d8b22e4230.png | https://www.americanexpress.com/us/credit-cards/card/hilton-honors-surpass/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000328_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Marriott Bonvoy Bevy American Express Card | assets/catalog-d064eb07004496ae.png | https://www.americanexpress.com/us/credit-cards/card/marriott-bonvoy-bevy/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000311_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Marriott Bonvoy Brilliant American Express Card | assets/catalog-73848fc7f063fa28.png | https://www.americanexpress.com/us/credit-cards/card/marriott-bonvoy-brilliant/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000313_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |
| Marriott Bonvoy Business American Express Card | assets/catalog-560b09d9bbb37339.png | https://www.americanexpress.com/us/credit-cards/business/business-credit-cards/amex-marriott-bonvoy-business-credit-card/ | https://icm.aexp-static.com/Internet/Acquisition/US_en/AppContent/OneSite/open/category/cardarts/amex-marriott-bonvoy-business.png | og:image | unmodified | 2026-11-11 | requires-permission |
| The Platinum Card | assets/catalog-925907b3857bfb57.png | https://www.americanexpress.com/us/credit-cards/card/platinum/ | https://icm.aexp-static.com/acquisition/card-art/NUS000000237_480x304_straight_withname.png | schema.org CreditCard image | unmodified | 2026-11-11 | requires-permission |

## Issuer card art, Amex HK (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Terms: the [American Express Hong Kong terms of use](https://www.americanexpress.com/en-hk/company/legal/privacy-centre/terms-and-conditions-of-use/) bar copying, displaying or publishing site content for commercial or public purposes and need written permission for its marks: `requires-permission`.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| American Express Platinum Credit Card | assets/catalog-4e8c39f996151fa6.png | https://www.americanexpress.com/hk/en/credit-cards/all-cards/ | https://icm.aexp-static.com/Internet/internationalcardshop/en_hk/images/cards/Platinum_Credit_Card.png | img alt='American Express Platinum Credit Card' (productCode platinum-credit-card) | resized from 1920x1216 to 480x304 | 2026-11-11 | requires-permission |

## Issuer card art, Amex CA (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Amex CA is archived for collection; the art only helps identify a card added by hand. Terms: the [American Express Canada online terms](https://www.americanexpress.com/en-ca/company/legal/online-terms-and-conditions/) use the same wording as Hong Kong: `requires-permission`.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| American Express Cobalt Card | assets/catalog-ad1699b31c81347f.png | https://www.americanexpress.com/en-ca/credit-cards/cobalt-card/ | https://icm.aexp-static.com/Internet/internationalcardshop/en_ca/images/pdp-uplift/consumer/cobalt-card/Cobalt-card.webp | preloaded hero image (served as PNG despite .webp); og:image is a 200x126 version cards/American_Express_Cobalt_Card.png | unmodified | 2026-11-11 | requires-permission |
| American Express Gold Rewards Card | assets/catalog-d37b82a264d5a56c.jpg | https://www.americanexpress.com/en-ca/credit-cards/gold-rewards-card/ | https://icm.aexp-static.com/Internet/internationalcardshop/en_ca/images/cards/Gold_Rewards_Card.png | img alt='American Express Gold Rewards Card' (served as JPEG; hero gold-card-art-ca.webp is the same art; og:image is a two-card gold/rose-gold composite) | unmodified | 2026-11-11 | requires-permission |
| SimplyCash Card from American Express | assets/catalog-d8dc74fe63f9f51a.jpg | https://www.americanexpress.com/en-ca/credit-cards/simply-cash/ | https://icm.aexp-static.com/Internet/internationalcardshop/en_ca/images/cards/SimplyCash_Card.png | og:image (served as JPEG) | unmodified | 2026-11-11 | requires-permission |
| SimplyCash Preferred Card from American Express | assets/catalog-f69ea6066048e6e7.png | https://www.americanexpress.com/en-ca/credit-cards/simply-cash-preferred/ | https://icm.aexp-static.com/Internet/internationalcardshop/en_ca/images/cards/SimplyCash_Preferred_Card.png | og:image | unmodified | 2026-11-11 | requires-permission |

## Issuer card art, Citi US (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Citi's pages serve WebP; files were converted to PNG without other change, so a file's bytes differ from the source while its pixels match. Terms: Citi's [terms and conditions](https://online.citi.com/US/ag/terms-and-conditions) page renders only with JavaScript and its text could not be read with curl: `unverified`. The name LINDA WALKER on the cards is Citi's sample.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Citi / AAdvantage Executive Card | assets/catalog-df8e239759158dfb.png | https://www.citi.com/credit-cards/citi-aadvantage-executive-world-legend-mastercard | https://aemapi.citi.com/content/dam/cfs/uspb/usmkt/cards/en/static/images/citi-aadvantage-executive-world-legend-mastercard/citi-aadvantage-executive-world-legend-mastercard_306x192.webp | schema.org image + hero img | converted from WebP to PNG, pixels unchanged | 2026-11-11 | unverified |
| Citi / AAdvantage Platinum Select Card | assets/catalog-479adf8548ca7e35.png | https://www.citi.com/credit-cards/citi-aadvantage-platinum-select-world-elite-mastercard | https://aemapi.citi.com/content/dam/cfs/uspb/usmkt/cards/en/static/images/citi-aadvantage-platinum-elite-credit-card/citi-aadvantage-platinum-select-elite-credit-card_306x192.webp | schema.org CreditCard image | converted from WebP to PNG, pixels unchanged | 2026-11-11 | unverified |
| Citi Custom Cash Card | assets/catalog-8603ba2b616a078c.png | https://www.citi.com/credit-cards/citi-custom-cash-credit-card | https://aemapi.citi.com/content/dam/cfs/uspb/usmkt/cards/en/static/images/citi-custom-cash-credit-card/citi-custom-cash-credit-card_306x192.webp | embedded JSON cardArtUrl._path | converted from WebP to PNG, pixels unchanged | 2026-11-11 | unverified |
| Citi Double Cash Card | assets/catalog-84ca71e365e6d028.png | https://www.citi.com/credit-cards/citi-double-cash-credit-card | https://aemapi.citi.com/content/dam/cfs/uspb/usmkt/cards/en/static/images/citi-double-cash-credit-card/citi-double-cash-credit-card_306x192.webp | schema.org CreditCard image | converted from WebP to PNG, pixels unchanged | 2026-11-11 | unverified |
| Citi Strata Elite Card | assets/catalog-5d37e05a20f3047d.png | https://www.citi.com/credit-cards/citi-strata-elite-credit-card | https://aemapi.citi.com/content/dam/cfs/uspb/usmkt/cards/en/static/images/citi-strata-elite-credit-card/citi-strata-elite-credit-card_306x192.webp | schema.org CreditCard image + hero img | converted from WebP to PNG, pixels unchanged | 2026-11-11 | unverified |
| Citi Strata Premier Card | assets/catalog-e051ee64912ecf07.png | https://www.citi.com/credit-cards/citi-strata-premier-credit-card | https://aemapi.citi.com/content/dam/cfs/uspb/usmkt/cards/en/static/images/citi-strata-premier-credit-card/citi-strata-premier-credit-card_306x192.webp | schema.org CreditCard image | converted from WebP to PNG, pixels unchanged | 2026-11-11 | unverified |

## Issuer card art, Capital One (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Terms: Capital One's [terms and conditions](https://www.capitalone.com/digital/terms-conditions/) say site materials may not be copied, displayed or reproduced for commercial or public purposes without prior written consent: `requires-permission`. Not filled: Spark Cash Plus, because every image of it on its page has an offer banner printed across the card ("OUR BEST OFFER" / "BIG CASH BONUSES").

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Savor Credit Card | assets/catalog-9dabc7b015153f5b.png | https://www.capitalone.com/credit-cards/savor/ | https://ecm.capitalone.com/WCM/card/products/new-savor-card-art.png | embedded WCM JSON asset new-savor-card-art.png (mobile rendition in page img) | unmodified | 2026-11-11 | requires-permission |
| Venture Rewards Credit Card | assets/catalog-46752794fb00afae.png | https://www.capitalone.com/credit-cards/venture/ | https://ecm.capitalone.com/WCM/card/products/venture-card-art.png | og:image (same art as hero img alt='Venture Rewards' venture_cardart_prim_323x203-1/mobile.png) | unmodified | 2026-11-11 | requires-permission |
| Venture X Business Card | assets/catalog-53f4b050628850e1.png | https://www.capitalone.com/small-business/credit-cards/venture-x-business/ | https://ecm.capitalone.com/WCM/card/products/vxb-card-alt-at-2x.png | schema.org product image | unmodified | 2026-11-11 | requires-permission |
| Venture X Rewards Credit Card | assets/catalog-19f845d03a5b4037.png | https://www.capitalone.com/credit-cards/venture-x/ | https://ecm.capitalone.com/WCM/card/products/venturex-cg-static-card-1000x630-2.png | img alt='Capital One Venture X credit card art' | unmodified | 2026-11-11 | requires-permission |

## Issuer card art, Discover (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Discover is part of Capital One; discover.com serves its card art from Capital One's content host and its footer links to the same Capital One terms: `requires-permission`. The only issuer image of Discover it Cash Back is slightly angled with a shadow.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Discover it Cash Back Credit Card | assets/catalog-bb0875740b89ae55.png | https://www.discover.com/credit-cards/cash-back/it-card/ | https://ecm.capitalone.com/WCM/dfs-card/products/cardart-cashit-with-shadow.png | data block imageUrl labelled 'Discover it Cash Back Card' | unmodified | 2026-11-11 | requires-permission |

## Issuer card art, U.S. Bank (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Both cards are vertical, as U.S. Bank shows them. Terms: the [U.S. Bank terms of use](https://www.usbank.com/about-us-bank/privacy/terms-of-use.html) limit content to personal use and bar copying or reproducing it; marks need express written permission: `requires-permission`.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| U.S. Bank Altitude Go Visa Signature Card | assets/catalog-8552729d1eac2910.png | https://www.usbank.com/credit-cards.html | https://www.usbank.com/content/dam/usbank/en/images/illustrations/card-art/credit-cards/altitude-go-visa-signature-credit-card.png | img alt='Altitude Go Visa Signature Card' data-alignment=vertical | unmodified | 2026-11-11 | requires-permission |
| U.S. Bank Cash+ Visa Signature Card | assets/catalog-b5a595ba2c7a2f48.png | https://www.usbank.com/credit-cards/cash-back-credit-cards.html | https://www.usbank.com/content/dam/usbank/en/images/illustrations/card-art/credit-cards/photo-cash-plus-signature-lg.png | img alt='U.S. Bank Cash Plus Signature Visa Card' (also on /credit-cards.html carousel) | unmodified | 2026-11-11 | requires-permission |

## Issuer card art, Wells Fargo (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. The page is A/B tested: on 2 of 3 reads it showed this image (an older variant shows a different image with an offer). It serves WebP/AVIF only; the WebP was converted to PNG without other change. Terms: the [Wells Fargo terms](https://www.wellsfargo.com/privacy-security/terms/) say site content, including images, may not be copied, displayed or reproduced except as they allow; marks need prior written consent: `requires-permission`.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Wells Fargo Autograph Journey Visa Card | assets/catalog-2d7ec71005902aeb.png | https://creditcards.wellsfargo.com/autograph-journey-visa-credit-card/ | https://creditcards.wellsfargo.com/rv/next/images/cards/autograph-journey.webp | img alt='Wells Fargo Autograph Journey Card' data-product-card-art (avif variant exists; png/jpg 404) | converted from WebP to PNG, pixels unchanged | 2026-11-11 | requires-permission |

## Issuer card art, Bank of America (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. Terms: no website terms-of-use page could be reached with curl (the footer is rendered by JavaScript; only "All Rights Reserved" was read): `unverified`. Not filled: Unlimited Cash Rewards (its only image has a "NEW OFFER" badge printed on the card), Royal ONE and Royal ONE Plus (their pages load card art only through JavaScript and name no image in their HTML).

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Allways Rewards Visa | assets/catalog-0fb1e79e89c661cb.png | https://www.bankofamerica.com/credit-cards/products/allegiant-credit-card/ | https://www.bankofamerica.com/content/images/ContextualSiteGraphics/CreditCardArt/en_US/Approved_PCM/ragp_sigcm_v_250.png | og:image (alt='Benefits and Rewards of an Allways Rewards Visa Credit Card') + schema.org CreditCard image | unmodified | 2026-11-11 | unverified |
| Atmos Rewards Ascent Visa Signature | assets/catalog-31f66fbd931ad272.png | https://www.bankofamerica.com/credit-cards/products/alaska-airlines-credit-card/ | https://www.bankofamerica.com/content/images/ContextualSiteGraphics/CreditCardArt/en_US/Approved_PCM/1bbt_sigcm_v_atmos_ascent_250.png | og:image (alt='Atmos Rewards Ascent Visa Signature Alaska Airlines Credit Card') + schema.org image | unmodified | 2026-11-11 | unverified |

## Issuer card art, HSBC HK (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. As with the existing HSBC art, the files are HSBC's 1600x900 product tiles shown cropped to the card. The student card's page shows the HSBC Visa Gold card face. Terms: the [HSBC HK terms of use](https://www.hsbc.com.hk/legal/terms-of-use/) bar reproducing or copying materials for commercial or public purposes without prior written consent: `requires-permission`.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| UnionPay Dual Currency Card | assets/catalog-3dcdee845d63c12a.jpg | https://www.hsbc.com.hk/credit-cards/products/unionpay-dual-currency-classic/ | https://www.hsbc.com.hk/content/dam/hsbc/hk/images/mass/credit-cards/tile-16-9/9358-hsbc-unionpay-credit-card-grey-1600x900.jpg | product picture (pp_tools_image) | shown cropped to x440,y224,w720,h453 | 2026-11-11 | requires-permission |
| Visa Gold Card for Students | assets/catalog-0fedec0b612e119c.jpg | https://www.hsbc.com.hk/credit-cards/products/student-visa-gold/ | https://www.hsbc.com.hk/content/dam/hsbc/hk/images/mass/credit-cards/tile-16-9/9358-hsbc-visa-gold-card-grey-1600x900.jpg | main product picture (pp_main_image) | shown cropped to x440,y224,w720,h453 | 2026-11-11 | requires-permission |

## Issuer card art, Standard Chartered HK (checked 2026-11-11, #230)

Read without login from the issuer's own public pages with curl (no browser), checked 2026-11-11. The owner asked for this art in #230; where the terms say `requires-permission`, showing it is the owner's decision, not permission from the issuer. To withdraw one, set the product's `art` to `null` in `src/data/card-products.json` and `card-product-overrides.json`. The images are the small (180x110) card faces in sc.com/hk's credit-card navigation, each labelled and linked to that card's page; the larger listing images carry titles and two card faces. Terms: the [Standard Chartered HK disclaimer](https://www.sc.com/hk/terms-and-conditions/disclaimer/) says site contents, including graphics, may not be copied or published without prior written consent: `requires-permission`.

| Product | File | Product page | Image | Found in | Stored | Checked | Terms |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A. Point Card | assets/catalog-390f5321a0ac9a82.png | https://www.sc.com/hk/credit-cards/ | https://www.sc.com/content/dam/sc/hk/shared/hk-cc-apoint-card.png | top navigation img alt='A.Point Card' linking to /hk/credit-cards/apointcard/ | shown cropped to x55,y0,w70,h110 | 2026-11-11 | requires-permission |
| Simply Cash Visa Card | assets/catalog-8c6ab7fb20a6ad88.png | https://www.sc.com/hk/credit-cards/ | https://www.sc.com/content/dam/sc/hk/shared/hk-sccc-180x110-1.png | top navigation img alt='Simple Cash Visa Card' linking to /hk/credit-cards/simplycash/ | unmodified | 2026-11-11 | requires-permission |
| Standard Chartered Smart Credit Card | assets/catalog-3a83e97c113acbb9.png | https://www.sc.com/hk/credit-cards/ | https://www.sc.com/content/dam/sc/hk/shared/hk-sc-cf2-180-110.png | top navigation img alt='Smart Card' linking to /hk/credit-cards/smart/ | unmodified | 2026-11-11 | requires-permission |

# Merchant and programme marks

Marks identify the service and belong to their owners; no endorsement is implied. An open-source icon package does not grant trademark rights: Simple Icons releases its project under CC0 but [asks users to seek the correct permissions](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md) for each brand.

Logos are bundled locally and never fetched at runtime. **On 2026-11-03 the owner decided to show a logo for every brand below. This is the project owner's decision, not permission from any brand.** No brand has granted permission. "Terms" records what the check found on public pages that day: `requires-permission` means published terms found require permission that has not been obtained; `unverified` means no grant could be located, which does not mean the brand allows or forbids this use. This is not legal advice. If a brand objects, set its entry to `unapproved` with `logo: null` in `src/data/logos.json`, so the item shows its category icon. Then delete its file from `public/brand/logos/` only if no other brand uses it; never delete from `public/brand/banks/` for this, because `BankMark` uses those files too. Then delete its file from `public/brand/logos/` only if no other brand uses it; never delete from `public/brand/banks/` for this, because `BankMark` uses those files too.

Files from official sites are the site's own icon or logo as published on 2026-11-03, converted to PNG and scaled to 64 pixels on the longest side where they were not SVG. Plaza Premium is the exception, kept at its 16 pixel source. Sources smaller than 64 pixels (for example Alaska, EVA, HK Express, Radisson, Aer Lingus and viagogo) were scaled up and can look soft. Some are favicons rather than formal logos and may differ from a brand's current logo.

Some programmes show a related company's mark, and are labelled as that company: Chase (The Edit, The Shops at Chase, Chase Sapphire Lounge, Chase Ultimate Rewards), American Express (Membership Rewards, Fine Hotels + Resorts, The Hotel Collection), HSBC (RewardCash), Alaska Airlines (Atmos Rewards), Air France (Flying Blue) and Morgan Stanley (CashPlus). Renowned Hotels and Resorts also shows Chase because its booking page is on chase.com, but its operator was not confirmed. Wyndham Rewards shows the mark from Wyndham's own site, which reads "WH".

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
| Home Chef | unverified | brand/logos/home-chef.png | https://compiled-production-assets.homechef.com/assets/fav/home_chef/favicon-196x196-1b92c821cd47e104eaa5b7bcea6fbfc1fbdad4b0e1851f6c149befedbbbedb15.png | not located | No published grant for third-party identifying use was located. |
| lululemon | unverified | brand/logos/lululemon.png | https://shop.lululemon.com/favicon.ico | https://shop.lululemon.com/help/legal/terms-of-use | Website terms bar framing its marks without written consent and warn that unauthorized use may violate trademark law; no grant located and no rule on identifying use. |
| Oura | requires-permission | brand/logos/oura.png | https://ouraring.com/assets/icons/apple-touch-icon.png | https://ouraring.com/guidelines-for-commercial-use | Commercial-use guidelines require written permission, which Oura may refuse or revoke (read from localized versions). |
| Walmart | requires-permission | brand/logos/walmart.png | https://www.walmart.com/apple-touch-icon.png | https://brandcenter.walmart.com/brand/trademarks | Brand center says its logos may only be used with prior written permission. |
| Disney | unverified | brand/logos/disney.png | https://static-mh.content.disney.io/matterhorn/assets/favicon-94e3862e7fb9.ico | not located | No published grant for third-party identifying use was located. |
| CLEAR | unverified | brand/logos/clear.png | https://cdn.prod.website-files.com/646a6ec3f634076bc7bf77f2/647f9537d0d4bfe668bed535_clear_favicon.png | not located | No published grant for third-party identifying use was located. |
| Priority Pass | unverified | brand/logos/priority-pass.png | https://www.prioritypass.com/icon.png | not located | Conditions of use cover membership only. No published grant for third-party identifying use was located. |
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
| Morgan Stanley CashPlus | unverified | brand/logos/morgan-stanley-cashplus.png | https://www.morganstanley.com/etc.clientlibs/msdotcomr5/clientlibs/components/site/resources/img/favicon-196x196.png | not located | No published grant for third-party identifying use was located. |
| Hilton | requires-permission | brand/banks/hilton.png | bundled: public/brand/banks/sources.json | https://www.hilton.com/en/p/site-usage-agreement/ | Site usage agreement says its marks may not be used without prior express written consent; the media kit publishes logos without a usage grant. |
| IHG One Rewards | unverified | brand/banks/ihg.ico | bundled: public/brand/banks/sources.json | not located | No published grant for third-party identifying use was located. |
| Marriott Bonvoy | unverified | brand/logos/marriott.svg | simple-icons@16.36.0:marriott | not located | No published grant for third-party identifying use was located. |
| World of Hyatt | unverified | brand/logos/hyatt.png | https://www.hyatt.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Radisson Rewards | unverified | brand/logos/radisson.png | https://www.radissonhotels.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| ALL Accor | unverified | brand/logos/accor.png | https://static-p46175-e229011.adobeaemcloud.com/a94cb9eb1ff932579db94bde99e19e82c898161919aceb909d9250d5401e2cf6/resources/images/favicon-32x32.png | not located | No published grant for third-party identifying use was located. |
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
| Malaysia Airlines Enrich | unverified | brand/logos/malaysia-airlines.png | https://www.malaysiaairlines.com/etc.clientlibs/mh/clientlibs/clientlib-vue/resources/favicon.ico | not located | No published grant for third-party identifying use was located. |
| EVA Infinity MileageLands | unverified | brand/logos/eva-air.png | https://www.evaair.com/favicon.ico | not located | No published grant for third-party identifying use was located. |
| Qantas Frequent Flyer | unverified | brand/logos/qantas.svg | simple-icons@16.36.0:qantas | not located | No published grant for third-party identifying use was located. |
| Etihad Guest | unverified | brand/logos/etihad.svg | simple-icons@16.36.0:etihadairways | not located | No published grant for third-party identifying use was located. |
| Emirates Skywards | unverified | null | null | not located | Not checked; no mark is shipped. |
| Qatar Airways Privilege Club | unverified | null | null | not located | Not checked; no mark is shipped. |
| Choice Privileges | unverified | null | null | not located | Not checked; no mark is shipped. |
| The Leading Hotels of the World Leaders Club | unverified | null | null | not located | Not checked; no mark is shipped. |
| Bilt Rewards | unverified | null | null | not located | Not checked; no mark is shipped. |
| Virgin Red | unverified | null | null | not located | Not checked; no mark is shipped. |
| Turkish Airlines Miles&Smiles | unverified | null | null | not located | Not checked; no mark is shipped. |
| TAP Miles&Go | unverified | null | null | not located | Not checked; no mark is shipped. |
| Japan Airlines Mileage Bank | unverified | null | null | not located | Not checked; no mark is shipped. |
| I Prefer Hotel Rewards | unverified | null | null | not located | Not checked; no mark is shipped. |
| Amtrak Guest Rewards | unverified | null | null | not located | Not checked; no mark is shipped. |
| Citi ThankYou Points | unverified | null | null | not located | Not checked; no mark is shipped. |
| American Airlines AAdvantage | unverified | null | null | not located | Not checked; no mark is shipped. |
| Capital One Miles | unverified | null | null | not located | Not checked; no mark is shipped. |

## Issuer marks

`public/brand/banks/` (sources in `public/brand/banks/sources.json`) holds American Express, Chase, HSBC, Standard Chartered, Bank of America, Hilton and IHG. They identify the user's own issuers and reward accounts in `BankMark`, and the owner's decision above covers them. Their terms have not been verified, except that Hilton's site usage agreement requires prior written consent.

## Category icons

Items that name no single brand show a category icon from `@ant-design/icons` (MIT). The airline icon is authored locally for this project.
