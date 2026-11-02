# Next steps: live distributor data

Handoff for the next Claude Code session. Read this first, then `README.md`.

## Goal

Turn the demo into a portfolio piece Ricardo can send to contacts in electronics manufacturing: a visitor types **any** manufacturer part number (MPN) and sees real specs, price, MOQ, stock, lead time and checked alternates. Visitors never set anything up.

## Decisions already made

- **Official APIs only**, never scraping TrustedParts, Octopart, Findchips or distributor pages. Their pages stay as one-click links (already on the page, `liveSources()` in `rules.js`).
- **Mouser Search API** first (key ready), then **Digi-Key Product Information v4** (2-legged OAuth, client credentials; endpoints ProductDetails, KeywordSearch, Substitutions, possibly PricingOptionsByQuantity).
- **Cloudflare Worker** in `worker/` holds the keys and calls the APIs; the page stays static on GitHub Pages and calls the Worker. Responses cached about 6 hours.
- Every number shows its **source and time** (“Mouser · 2 h ago”). Missing data stays empty. If an API fails, the page says so and keeps the live links. Nothing is ever invented.
- Price shown is for the quantity the visitor needs, using the price break at or below the **order quantity** (at least the MOQ, rounded up to the order multiple). Show packaging (cut tape vs reel).
- Later: an MCP server exposing `find_alternates(...)` so an agent can use the same logic.

## Content rules (keep)

- Page copy in English, typographic punctuation (’ “ ”) in visible text.
- Byline: supply chain consultant (Kinaxis Maestro implementations in pharma, food and aerospace) who previously led electronic-component planning and purchasing in automotive electronics manufacturing. **Never call Ricardo a “planner”. Never name his previous employer.**
- Never invent part numbers, specs, prices or certifications.
- Mobile first; keep light/dark mode, safe-area padding, focus handling, the live-region summary.
- Work on `main` of `andreevazquez/mlcc-alternate-finder` (GitHub Pages serves `main`, root). Small, clearly described commits. Run `npm test` before pushing.

## Status

- Done: rules engine, demand and approval planning, datasheet comparison (green/yellow/red), type of change, simulated prices with USD/MXN, live links to TrustedParts, Octopart, Findchips, Digi-Key, Mouser.
- Started: `worker/src/mouser.js` (request + normaliser, unit-tested against a hand-written fixture in `tests/mouser.test.js`) and `worker/src/index.js` (`GET /part?mpn=…`). **Field names follow Mouser’s public docs but have not been checked against a real response.**

## Environment the next session needs

Set by Ricardo in the environment settings (session title bar → Edit), then a **new** session:

- Secret `MOUSER_API_KEY` (done on Mouser’s side; must be added to the environment).
- Secrets `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET` (Digi-Key app, Production, product “Product Information V4”).
- Allowed domains: `api.mouser.com`, `api.digikey.com`, `developer.digikey.com`.
- For deploying the Worker from the session: secret `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`), domains `api.cloudflare.com`, `registry.npmjs.org`. Or Ricardo deploys from his computer with `npx wrangler deploy`.

## Steps

1. Check the environment: the variables are set (print only whether they exist, never their values) and `api.mouser.com` is reachable.
2. Call Mouser for `GRM188R71H104KA93D`. Compare the real JSON with `normalizeMouserPart`; fix field names; save a trimmed real response as a test fixture **only if Mouser’s terms allow it**, otherwise keep the hand-written one.
3. Add the Digi-Key adapter the same way (`worker/src/digikey.js`): token, ProductDetails, then KeywordSearch with parametric filters to find alternates for any MPN.
4. Map both sources to the shape `rules.js` needs (cap, v, pkg, diel, tol, grade, mfr, stock, lead, price, moq, multiple, lifecycle, datasheet), so `evaluate()` and `rank()` run on live parts.
5. Wire `app.js` to the Worker: any MPN → live data with source and time; keep the 30-part demo catalog as a fallback and say when it’s used.
6. Deploy the Worker, set `ALLOWED_ORIGIN`, put its URL in `app.js`, update README, check on a phone, push.
7. Then the BOM risk report (paste several lines, get shortage and alternate status per line) and the MCP server.
