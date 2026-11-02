# MLCC Alternate Finder

Your capacitor is on allocation. Find a drop-in alternate.

A single-page tool that finds alternates for a multilayer ceramic capacitor (MLCC) that is out of stock or on long lead time. Enter a part number or a raw BOM line such as `CAP CER 10UF 10V X5R 0805`, and the page checks every part in its catalog against the substitution rules a planner and a component engineer apply before approving a substitute. Each candidate is marked **Drop-in**, **Fits, needs review**, or **Not compatible**, with the reason for every check.

- **Live demo:** <https://andreevazquez.github.io/mlcc-alternate-finder/>
- **Deep link example:** <https://andreevazquez.github.io/mlcc-alternate-finder/#GRM188R71H104KA93D> opens with that part loaded.

## What you can enter

- **Part number:** an exact match, or a unique prefix of at least 8 characters. An ambiguous prefix asks you to pick; an unknown one suggests describing the part instead.
- **BOM description:** free text. The page reads capacitance (`100p`, `100n`, `0.1uF`, `10UF`), voltage (`50V`), case size (`0201`–`1210`), dielectric (`C0G`/`NP0`, `X7R`, `X5R`, `Y5V`), tolerance (`10%`) and grade keywords (`AEC-Q200`, `automotive`, `medical`).

Two options shape the search:

- **Looking for:** *Equivalent* or *Better than original*.
- **Grade required:** *Same as the original*, *Commercial*, *Automotive (AEC-Q200)* or *Medical*.

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
| Manufacturer | A new manufacturer is an information note (it needs an approved-vendor-list entry); it doesn’t change the verdict. |

**Ranking**

- *Equivalent:* verdict first, then shortest lead time, then most stock.
- *Better than original:* only candidates that improve at least one spec or the grade while giving nothing up, sorted by number of improvements, then fit, then availability. Each shows what it’s better on.

## About the data

- The catalog holds **30 MLCCs** (100 pF, 0.1 µF, 1 µF and 10 µF) from Murata, TDK, Samsung, Yageo, KEMET and KYOCERA AVX, in commercial and AEC-Q200 grades.
- **Specs follow each manufacturer’s part-numbering scheme but have not all been verified against datasheets.** [DATA_CHECK.md](DATA_CHECK.md) tracks that verification. Always confirm against the datasheet before approving a substitute.
- **Stock and lead times are simulated.**
- **There are no medical-grade parts, on purpose.** Inventing part numbers would be worse than leaving them out. A medical search explains what’s required instead: the manufacturer’s medical-grade series and, for life-support or implantable use, the manufacturer’s written approval.

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
| `scripts/make-og-image.mjs` | Regenerates `og-image.png` and `apple-touch-icon.png` (needs Playwright: `npm i --no-save playwright && npx playwright install chromium`, then `npm run og-image`) |
| `DATA_CHECK.md` | Datasheet verification checklist for the catalog |

## Author

Built by Ricardo Vázquez, supply chain consultant who has implemented Kinaxis Maestro planning for pharma, food and aerospace companies. Before that, he led electronic-component planning and purchasing in automotive electronics manufacturing.

## License

[MIT](LICENSE)
