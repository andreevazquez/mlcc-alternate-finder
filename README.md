# MLCC Alternate Finder

Your capacitor is on allocation. Find a drop-in alternate.

A single-page tool that finds alternates for a multilayer ceramic capacitor (MLCC) that is out of stock or on long lead time. Enter a part number or a raw BOM line such as `CAP CER 10UF 10V X5R 0805`, and the page checks every part in its catalog against the substitution rules a planner and a component engineer apply before approving a substitute. Each candidate is marked **Drop-in**, **Fits, needs review**, or **Not compatible**, with the reason for every check.

- **Live demo:** <https://andreevazquez.github.io/mlcc-alternate-finder/>
- **Deep link example:** <https://andreevazquez.github.io/mlcc-alternate-finder/#GRM188R71H104KA93D> opens with that part loaded.

## What you can enter

- **Part number:** an exact match, or a unique prefix of at least 8 characters. An ambiguous prefix asks you to pick; an unknown one suggests describing the part instead.
- **BOM description:** free text. The page reads capacitance (`100p`, `100n`, `0.1uF`, `10UF`), voltage (`50V`), case size (`0201`–`1210`), dielectric (`C0G`/`NP0`, `X7R`, `X5R`, `Y5V`), tolerance (`10%`) and grade keywords (`AEC-Q200`, `automotive`, `medical`).

Options that shape the search:

- **Looking for:** *Equivalent* or *Better than original*.
- **Grade required:** *Same as the original*, *Commercial*, *Automotive (AEC-Q200)* or *Medical*.
- **Demand and cost (optional):** quantity needed (`250000`, `250,000` or `250k`), the date you need it by, and your exchange rate in MXN per USD.

## Substitution rules

| Spec | Rule |
| --- | --- |
| Capacitance | Must match. |
| Case size | Must match: a different case won’t fit the footprint. |
| Voltage rating | Can only go up. Going up passes but is flagged for review: a higher rating can mean a taller part. |
| Dielectric | Can only go up: Y5V < X5R < X7R < C0G. An upgrade is flagged for engineering confirmation. |
| Tolerance | Can only get tighter. |
| Grade | Not a ladder. AEC-Q200 satisfies commercial. Only a manufacturer’s medical-grade series satisfies medical; automotive never does. |
| Missing fields | Anything a description leaves out is flagged for review, never silently passed. |
| Lifecycle | End of life is ruled out; not recommended for new designs (NRND) needs review. Until a part’s status is verified, it shows as a note to check. |
| Manufacturer | A new manufacturer is an information note (it needs an entry on the approved manufacturer list, AML); it doesn’t change the verdict. |

## Datasheet comparison

The top three candidates appear side by side with the original, and every candidate card uses the same colors:

| Color | Meaning | Examples |
| --- | --- | --- |
| Green ✓ | Same as the original | Same capacitance, case, voltage, dielectric, manufacturer |
| Yellow ≈ | Differs, without affecting the design | Tighter tolerance, AEC-Q200 where commercial is required, wider temperature range, new manufacturer, lifecycle not yet verified |
| Red ! | Needs a product engineer | Higher voltage rating (taller part), different dielectric, a spec the description left out, NRND |

Each candidate also gets a **type of change**, from the steps it needs:

- **Drop-in:** same manufacturer and fit; only an AML entry.
- **Minor change:** new manufacturer; samples and an AML entry, no design change.
- **Major change:** a product engineer must review it or, for an automotive design, it needs PPAP and customer approval.

Below the specs, the table shows type of change, lead time, stock, the date each part is usable in production, the simulated unit price and, with a quantity, the total cost and the difference against the original, in USD and, with an exchange rate, MXN.

## Planning: when can each alternate go into production?

An alternate is only useful once it’s both **approved** and **in hand**. For every candidate the page shows:

- **Supply:** immediate if distribution stock covers the quantity needed (or, with no quantity, if there is any stock); otherwise the factory lead time. With a quantity, it shows how much of it stock covers.
- **Approval path:** the steps the change needs, with typical durations:

  | Step | When | Weeks |
  | --- | --- | --- |
  | Engineering review | The candidate is marked “needs review” | 2 |
  | Samples and build validation | New manufacturer (or unknown, for a description search) | 3 |
  | PPAP and customer approval | The design is automotive | 6 |
  | AML and ERP item master entry | Always | 1 |

- **Usable in production:** the later of supply and approval, assuming you order while approval runs. With a need date, each candidate is marked on time or weeks late.
- **The cost of waiting:** for a part-number search with a need date, the original part’s own date, so every alternate is compared against simply waiting.

Durations are assumptions that vary by company and customer; they live in `APPROVAL_STEPS` in `rules.js`.

## Ranking

- *Equivalent:* with a need date, parts usable on time come first. Then the smallest type of change (drop-in, minor, major), then fit, then soonest usable, then shortest lead time and most stock.
- *Better than original:* only candidates that improve at least one spec or the grade while giving nothing up, sorted by number of improvements, then the same order as above. Each shows what it’s better on.

## About the data

- The catalog holds **30 MLCCs** (100 pF, 0.1 µF, 1 µF and 10 µF) from Murata, TDK, Samsung, Yageo, KEMET and KYOCERA AVX, in commercial and AEC-Q200 grades.
- **Specs follow each manufacturer’s part-numbering scheme but have not all been verified against datasheets.** [DATA_CHECK.md](DATA_CHECK.md) tracks that verification. Always confirm against the datasheet before approving a substitute.
- **Stock, lead times and prices are simulated.** Prices are illustrative unit prices at reel quantity, in USD.
- **Live data is one click away.** Every part links to its search page on TrustedParts, Octopart, Findchips, Digi-Key and Mouser, which show live price, stock and MOQ. The page links to them; it doesn’t copy their data.
- **Lifecycle status (active, NRND, EOL) isn’t verified for any part yet.** It’s a column in DATA_CHECK.md; once filled in, add it to the part in `rules.js` as `life:"Active"`, `"NRND"` or `"EOL"`.
- **There are no medical-grade parts, on purpose.** Inventing part numbers would be worse than leaving them out. A medical search explains what’s required instead: the manufacturer’s medical-grade series and, for life-support or implantable use, the manufacturer’s written approval.

## Live data (in progress)

A Cloudflare Worker in `worker/` will give any manufacturer part number real specs, stock, MOQ, lead time and prices from authorised distributors. The page stays static and calls the Worker; the API keys stay in the Worker.

- **Sources:** Octopart’s API (Nexar) first, for offers from many distributors at once; Mouser’s Search API when Nexar fails or its monthly quota is used up. Official APIs only, no scraping.
- **What the page shows:** a table of distributor offers (stock, MOQ and order multiple, lead time, packaging, price), the source and how old the data is (“Octopart (Nexar) · 2 h ago”), and alternates found by capacitance and case, checked with the same rules as the demo.
- **Price:** for the quantity you need, rounded up to the MOQ and order multiple, at the distributor whose stock covers it for the least total spend.
- **Missing data stays missing.** No stock, lead time or price is guessed: the page says “Not listed”, and a part without voltage, case or a supported dielectric isn’t ranked. If the Worker can’t answer, the page says why and uses the demo catalog.
- **Descriptions** (`0.1uF 50V X7R 0603`) still search the demo catalog.

Until `API_URL` in `app.js` is set to the Worker’s address, the page uses only the demo catalog.

### Deploy the Worker

Set three secrets on the Worker (Cloudflare dashboard → Workers & Pages → `mlcc-alternate-finder-api` → Settings → Variables and Secrets, or `npx wrangler secret put NAME` in `worker/`): `NEXAR_CLIENT_ID`, `NEXAR_CLIENT_SECRET` (a Nexar app with the Supply scope) and `MOUSER_API_KEY` (the Search API key). `ALLOWED_ORIGIN` in `worker/wrangler.toml` lists the sites allowed to call it.

```sh
cd worker && npx wrangler deploy
```

Then check `https://<worker>/part?mpn=GRM188R71H104KA93D` and put the Worker’s URL in `API_URL`.

## Run it locally

No build step and no dependencies. The JavaScript loads as ES modules, which browsers won’t run from `file://`, so serve the folder:

```sh
npm start              # same as: python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static file server works.

## Run the tests

Requires Node 18 or later. Uses the built-in `node:test` runner; nothing to install.

```sh
npm test
```

## Project layout

| File | Contents |
| --- | --- |
| `index.html` | Markup and link-preview meta tags |
| `styles.css` | Styles, light and dark mode |
| `rules.js` | Catalog, parsing, rules, ranking and formatting. Pure logic, no DOM |
| `app.js` | Rendering and event wiring |
| `tests/rules.test.js` | Tests for `rules.js` |
| `worker/src/index.js` | Cloudflare Worker: `GET /part?mpn=…`, source order and caching |
| `worker/src/nexar.js`, `worker/src/mouser.js` | Nexar and Mouser requests and response parsing |
| `worker/src/parts.js` | Maps distributor data to the part shape `rules.js` checks |
| `tests/live.test.js`, `tests/mouser.test.js` | Tests for the Worker, against hand-written fixtures |
| `scripts/make-og-image.mjs` | Regenerates `og-image.png` and `apple-touch-icon.png` (needs Playwright: `npm i --no-save playwright && npx playwright install chromium`, then `npm run og-image`) |
| `DATA_CHECK.md` | Datasheet verification checklist for the catalog |

## Author

Built by Ricardo Vázquez, supply chain consultant who has implemented Kinaxis Maestro planning for pharma, food and aerospace companies. Before that, he led electronic-component planning and purchasing in automotive electronics manufacturing.

## License

[MIT](LICENSE)
