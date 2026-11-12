# Cardybara product site

One static page (`index.html`, Chinese first with an English toggle, light/dark from the system) and the share images
for WeChat / 小红书 / 朋友圈 (stl00/Cardybara#239). No framework, no third-party requests, no cookies, analytics or forms.

| Path | What |
| --- | --- |
| `index.html`, `_headers` | The page and its Cloudflare Pages headers (strict CSP, no referrer). |
| `assets/` | Brand marks (copies of `public/cardybara.svg`, `public/brand/zen.svg`) and `shots/`, screenshots of the real wallet UI. |
| `share/fixture/wallet.json` | The **synthetic** wallet every screenshot uses. All amounts, tails and dates are made up. |
| `share/capture.mjs` | Runs the wallet from source (same Vite config as `npm run dev`, on port 8791) with that fixture and captures `assets/shots/*.webp` in headless Chrome. The assistant shot uses a scripted model that calls the wallet's own `choose_card` tool and answers only from its result; no model key or network. |
| `share/templates/` | HTML templates for the share images. |
| `share/out/` | Rendered images: `og.png` 1200×630, `carousel-1…4.png` 1080×1440, `square.png` 1080×1080. |

Every text claim on the page must match `docs/release-notes/beta-1.md` and the in-extension About page
(`src/ReleaseNotes.jsx`); the privacy section repeats their wording. Update all three together.

## Regenerate

```sh
npm run site:shots    # screenshots from the real UI (needs Chrome; never touches public/data.json)
npm run site:share    # share images from the templates
npm run build:site    # dist/site, checked for third-party resources and forms
```

## Deploy (owner-approved only)

Cloudflare Pages project `cardybara`. Preview first, production only after the owner approves:

```sh
npm run build:site && npx --yes wrangler@4.155.0 pages deploy dist/site --project-name cardybara --branch preview
```

or run the **Deploy product site** workflow by hand on main (`target: preview`; it refuses other branches). It needs `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` in the `site` environment. `og:image` points at `https://cardybara.pages.dev/share/og.png`;
change it if the site gets its own domain.
