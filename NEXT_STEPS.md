# Next steps: live distributor data

Handoff for the next Claude Code session. Read this first, then `README.md`.

## Goal

Turn the demo into a portfolio piece Ricardo can send to contacts in electronics manufacturing: a visitor types **any** manufacturer part number (MPN) and sees real specs, price, MOQ, stock, lead time and checked alternates. Visitors never set anything up.

## Decisions already made

- **Official APIs only**, never scraping TrustedParts, Octopart, Findchips or distributor pages. Their pages stay as one-click links (already on the page, `liveSources()` in `rules.js`).
- **Nexar (Octopart’s API) is the primary source** (account ready). GraphQL at `https://api.nexar.com/graphql`, token from `https://identity.nexar.com/connect/token` (client credentials, Supply scope). One query gives offers from many authorised distributors (TTI, Digi-Key, Mouser, Arrow, Avnet…) with price breaks, MOQ, stock, factory lead time and packaging, plus specs, lifecycle, datasheet and similar parts. Show a per-distributor offers table, like Octopart. The free plan has a monthly part quota: cache aggressively and check the quota in the Nexar portal.
- **Mouser Search API** is the fallback when Nexar fails or its quota runs out (key ready).
- Digi-Key Product Information v4 is optional now; add it only if Nexar’s data falls short.
- **Cloudflare Worker** in `worker/` holds the keys and calls the APIs; the page stays static on GitHub Pages and calls the Worker. Responses cached about 6 hours.
- Every number shows its **source and time** (“Mouser · 2 h ago”). Missing data stays empty. If an API fails, the page says so and keeps the live links. Nothing is ever invented.
- Price shown is for the quantity the visitor needs, using the price break at or below the **order quantity** (at least the MOQ, rounded up to the order multiple). Show packaging (cut tape vs reel).
- Later: an MCP server exposing `find_alternates(...)` so an agent can use the same logic.

## Content rules (keep)

- Page copy in English, typographic punctuation (’ “ ”) in visible text.
- Byline: supply chain consultant (Kinaxis Maestro implementations in pharma, food and aerospace) who previously led electronic-component planning and purchasing in automotive electronics manufacturing. **Never call Ricardo a “planner”. Never name his previous employer.**
- Never invent part numbers, specs, prices or certifications.
- Mobile first; keep light/dark mode, safe-area padding, focus handling, the live-region summary.
- Work on `main` of `andreevazquez/mlcc-alternate-finder` (or the branch the session names, then merge) (GitHub Pages serves `main`, root). Small, clearly described commits. Run `npm test` before pushing.

## Status

- Done: rules engine, demand and approval planning, datasheet comparison (green/yellow/red), type of change, simulated prices with USD/MXN, live links to TrustedParts, Octopart, Findchips, Digi-Key, Mouser.
- Done (session of 2 Nov 2026), **untested against real APIs**:
  - `worker/src/nexar.js`: token (cached per isolate), `supSearchMpn` and `supSearch` queries, offer normalisation, quota detection.
  - `worker/src/parts.js`: parses Nexar specs and Mouser descriptions into the `rules.js` shape (`pn, mfr, cap, v, pkg, diel, tol, grade, life, stock, lead, offers, datasheet`).
  - `worker/src/index.js`: Nexar first, Mouser fallback (also on quota), part and alternates cached 6 h with the real fetch time, `ALLOWED_ORIGIN` takes a comma-separated list.
  - `rules.js`: `rank()` takes live candidates, counts the ones it can’t check, keeps unknown stock/lead/price unknown; `bestOffer()`/`priceLive()` price the order quantity.
  - `app.js`: any MPN goes to the Worker when `API_URL` is set; source and age shown; offers table; demo fallback with the reason. Checked in a browser with a stubbed Worker at 390 px and 1280 px.
- **Blocked:** in that session both providers rejected the keys in the environment: Nexar’s token endpoint answered `invalid_client` and Mouser answered `Invalid unique identifier` for the API key. Ricardo then connected Cloudflare Workers Builds (path `/worker`); the Worker is live at `https://mlcc-alternate-finder-api.ricardovazqueztovar.workers.dev` and `API_URL` points to it. `*.workers.dev` isn’t in this environment’s allowed domains, so a session can’t call it; add it to test from here.

## First real Mouser response (2 Nov 2026, GRM188R71H104KA93D, seen in a screenshot)

- The key works. Field names `ManufacturerPartNumber`, `MouserPartNumber`, `Manufacturer`, `Description`, `Min`, `Mult`, `LifecycleStatus`, `ProductDetailUrl`, `PriceBreaks` are right.
- Mouser lists this part as **Obsolete** (`lifecycle: "Obsolete"` → `EOL`), with no stock, no lead time, no price breaks and no packaging attribute.
- **The description comes in Spanish** (the account is on mouser.mx: “Capacitores cerámicos de capas múltiples (MLCC) - SMD/SMT RECOMMENDED ALT 81-GRM188R72A104KA35”) and, for this obsolete part, holds no specs. So `fromMouser` can’t read capacitance or case and no alternates are searched. To do: ask Mouser for English or read `ProductAttributes`; parse “RECOMMENDED ALT 81-…” and show it as Mouser’s suggested replacement (labelled as Mouser’s, not checked).

## What Ricardo needs to do

1. **Nexar:** in portal.nexar.com, open the app, check it has the **Supply** scope, and copy the Client ID and Client Secret again (regenerate the secret if unsure). Update `NEXAR_CLIENT_ID` / `NEXAR_CLIENT_SECRET` in the environment settings.
2. **Mouser:** in My Mouser → APIs, use the **Search API** key (not the Cart/Order API key). Update `MOUSER_API_KEY`.
3. **Cloudflare:** either add `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` to the environment (with `api.cloudflare.com`, `registry.npmjs.org` allowed), or deploy from your computer (`cd worker && npx wrangler deploy`), or, with Workers Builds connected to this GitHub repo, set the build’s root directory to `worker/`. In all cases add the three secrets to the Worker itself.
4. Start a **new** session so the changed secrets load.

## Steps

1. Check the environment: the variables are set (print only whether they exist, never their values) and the API hosts are reachable.
2. ~~Add `worker/src/nexar.js`~~ (done, verify): token (cache it until it expires), a `supSearchMpn` query for one MPN (specs, sellers → offers with prices/moq/inventoryLevel/factoryLeadDays/packaging, lifecycle, datasheet) and a parametric search for alternates (same capacitance and case). Check field names in the Nexar playground schema; test with a hand-written fixture.
3. Call Nexar and Mouser for `GRM188R71H104KA93D`. Compare the real JSON with `normalizeNexarPart` and `normalizeMouserPart` (and the spec names `fromNexar` looks for in `parts.js`) and fix field names. Check what Nexar counts against the quota (alternates search uses `ALTERNATES_LIMIT = 20` parts). Keep test fixtures hand-written unless the provider’s terms allow storing real responses.
4. ~~Map the sources~~ (done, verify with real data) to the shape `rules.js` needs (cap, v, pkg, diel, tol, grade, mfr, stock, lead, price, moq, multiple, lifecycle, datasheet), so `evaluate()` and `rank()` run on live parts.
5. ~~Wire `app.js`~~ (done) to the Worker: any MPN → live data with source and time; keep the 30-part demo catalog as a fallback and say when it’s used.
6. Deploy the Worker, set `ALLOWED_ORIGIN`, put its URL in `app.js`, update README, check on a phone, push.
7. ~~Quota message and Mouser fallback~~ (done). Keep an eye on the Nexar quota: show a clear message when it’s exhausted and fall back to Mouser.
8. Then the BOM risk report (paste several lines, get shortage and alternate status per line) and the MCP server.
