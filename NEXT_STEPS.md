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
- Started: `worker/src/mouser.js` (request + normaliser, unit-tested against a hand-written fixture in `tests/mouser.test.js`) and `worker/src/index.js` (`GET /part?mpn=…`). **Field names follow Mouser’s public docs but have not been checked against a real response.**

## Environment the next session needs

Set by Ricardo in the environment settings (session title bar → Edit), then a **new** session:

- Secrets `NEXAR_CLIENT_ID`, `NEXAR_CLIENT_SECRET` (Nexar app with the Supply scope) and `MOUSER_API_KEY`.
- Allowed domains: `api.nexar.com`, `identity.nexar.com`, `api.mouser.com`.
- Optional later: `DIGIKEY_CLIENT_ID`, `DIGIKEY_CLIENT_SECRET`, domains `api.digikey.com`, `developer.digikey.com`.
- For deploying the Worker from the session: secret `CLOUDFLARE_API_TOKEN` (and `CLOUDFLARE_ACCOUNT_ID`), domains `api.cloudflare.com`, `registry.npmjs.org`. Or Ricardo deploys from his computer with `npx wrangler deploy`.

## Steps

1. Check the environment: the variables are set (print only whether they exist, never their values) and the API hosts are reachable.
2. Add `worker/src/nexar.js`: token (cache it until it expires), a `supSearchMpn` query for one MPN (specs, sellers → offers with prices/moq/inventoryLevel/factoryLeadDays/packaging, lifecycle, datasheet) and a parametric search for alternates (same capacitance and case). Check field names in the Nexar playground schema; test with a hand-written fixture.
3. Call Mouser for `GRM188R71H104KA93D`. Compare the real JSON with `normalizeMouserPart` and fix field names. Keep test fixtures hand-written unless the provider’s terms allow storing real responses.
4. Map the sources to the shape `rules.js` needs (cap, v, pkg, diel, tol, grade, mfr, stock, lead, price, moq, multiple, lifecycle, datasheet), so `evaluate()` and `rank()` run on live parts.
5. Wire `app.js` to the Worker: any MPN → live data with source and time; keep the 30-part demo catalog as a fallback and say when it’s used.
6. Deploy the Worker, set `ALLOWED_ORIGIN`, put its URL in `app.js`, update README, check on a phone, push.
7. Keep an eye on the Nexar quota: show a clear message when it’s exhausted and fall back to Mouser.
8. Then the BOM risk report (paste several lines, get shortage and alternate status per line) and the MCP server.
