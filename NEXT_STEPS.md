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
- Work on `main` of `andreevazquez/mlcc-alternate-finder` (GitHub Pages serves `main`, root). Small, clearly described commits. Run `npm test` before pushing.

## Status

- Done: rules engine, demand and approval planning, datasheet comparison (green/yellow/red), type of change, simulated prices with USD/MXN, live links to TrustedParts, Octopart, Findchips, Digi-Key, Mouser.
- Done (session of 2 Nov 2026), **all unverified against real responses** because the keys didn’t work (see below):
  - `worker/src/nexar.js`: token cached until expiry; `supSearchMpn` query with offers and `similarParts`; parametric `supSearch` on capacitance + case_package; quota detection (GraphQL error text or HTTP 429).
  - `worker/src/mouser.js`: specs parsed from `ProductAttributes`; one MPN listed per packaging merged into several offers; keyword search for alternates.
  - `worker/src/specs.js`: shared parsers (capacitance, voltage, case, dielectric, tolerance, lifecycle, AEC-Q200).
  - `worker/src/index.js`: Nexar first, Mouser fallback; after a quota answer Nexar is skipped for 1 h; cache 6 h, 1 h for Mouser-only answers, errors not cached; page notices.
  - `live.js` (page side): offers → `rules.js` shape (stock summed, shortest lead, cheapest offer **by total at the order quantity**); source and age labels.
  - `rules.js`: `rank()` takes a `pool`; missing specs are flagged (“not listed by the source”), unknown EIA dielectrics (X6S, X7S, X8R…) need review, and their temperature range is read from the EIA code; unknown lead time leaves the usable date unknown.
  - `app.js`: any MPN → Worker → live card with a per-distributor offers table, source and time, datasheet link; falls back to the demo catalog and says why. `WORKER_URL` is still empty, so the live site is unchanged. On localhost, `?api=http://localhost:8787` points at `wrangler dev`.
  - Tests: 91 passing (`npm test`), fixtures hand-written. Checked in Chromium at 390 px and 1200 px, light and dark, against a local mock running the real `lookup()`.

## Blocker found on 2 Nov 2026

The secrets `NEXAR_CLIENT_ID`, `NEXAR_CLIENT_SECRET` and `MOUSER_API_KEY` exist in the environment, but each holds only “…” (3 characters), a placeholder rather than the real value. Nexar answered `invalid_client` and Mouser `Invalid unique identifier`. Ricardo needs to paste the full values in the environment settings and start a new session. The hosts `identity.nexar.com`, `api.nexar.com` and `api.mouser.com` are reachable; `api.cloudflare.com` is blocked (403).

## Environment the next session needs

Set by Ricardo in the environment settings (session title bar → Edit), then a **new** session:

- Secrets `NEXAR_CLIENT_ID`, `NEXAR_CLIENT_SECRET` (Nexar app with the Supply scope) and `MOUSER_API_KEY`.
- Allowed domains: `api.nexar.com`, `identity.nexar.com`, `api.mouser.com`.
- Optional later: `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, domains `api.digikey.com`, `developer.digikey.com`.
- For deploying the Worker from the session: secret `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`), domains `api.cloudflare.com`, `registry.npmjs.org`. Or Ricardo deploys from his computer with `npx wrangler deploy`.

## Steps

1. Check the environment: the variables are set **and longer than a few characters** (print only lengths, never values) and the API hosts are reachable.
2. Get a Nexar token and run `MPN_QUERY` from `worker/src/nexar.js` for `GRM188R71H104KA93D`. Compare with `normalizeNexarPart`: spec shortnames (`capacitance`, `voltagerating_dc_`, `case_package`, `dielectric`, `tolerance`, `lifecyclestatus`, `qualification`), whether `supSearchMpn` accepts `currency`, the `sellers(authorizedOnly:)` argument, and the `filters` format for `ALTERNATES_QUERY` (is the capacitance value `1e-07` or something else?). Fix names; update the hand-written fixtures in `tests/nexar.test.js` to the real shape (without copying real values unless the terms allow it). Check how many parts one query costs against the quota: `similarParts` may count each part.
3. Same for Mouser (`mouserRequest`, then `mouserKeywordRequest("100nF 0603 ceramic capacitor")`): attribute names (`Capacitance`, `Voltage Rating DC`, `Case Code - in`, `Dielectric`, `Tolerance`, `Qualification`), `PriceBreaks`, `LeadTime`, `LifecycleStatus`.
4. Run `cd worker && npx wrangler dev` with the secrets in `worker/.dev.vars` (already git-ignored), open `http://localhost:8000/?api=http://localhost:8787`, and try a few real MPNs (Murata, TDK, Samsung, Yageo, an AEC-Q200 part, an obsolete part).
5. Deploy the Worker (Ricardo, from his computer: `cd worker && npx wrangler deploy` and `npx wrangler secret put …` for the three secrets; `api.cloudflare.com` is blocked from the cloud session). Put its URL in `WORKER_URL` in `app.js`, update the footer “About the data” in `index.html` and the README, check on a phone, push.
6. Watch the Nexar quota in the portal after launch; the page already says when it’s used up and falls back to Mouser.
7. Then the BOM risk report (paste several lines, get shortage and alternate status per line) and the MCP server exposing `find_alternates(...)`.
