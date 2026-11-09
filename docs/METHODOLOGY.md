# Methodology

Every rule the finder applies, what it does to a candidate, and where it lives in the code. All rules are pure functions with no DOM access, so the page and `node --test` run the same code.

- `js/rules.js`: catalog, rules, review flags, approval, supply, cost and ranking.
- `js/mpn.js`: specs read from the part number.
- `worker/src/parts.js`: maps distributor data onto the same part shape.

`tests/rules-edges.test.js` checks each rule at its edges on hand-built parts: equal, one step better, one step worse, and unknown. `tests/rules.test.js` checks the rules on the demo catalog.

Units: capacitance in pF, voltage in V, tolerance in %, with +80/−20% stored as 80. Height is the maximum in mm, and lead time is in weeks.

---

## 1. What each check can do

Each check produces one row of the datasheet comparison, with a **state** and a **level** (`evaluate()` in `js/rules.js`).

The **state** sets the verdict:

| State | Effect on the candidate |
|---|---|
| `ok` | Passes |
| `info` | A note. It never changes the verdict. |
| `warn` | **Fits, needs review**: it goes to a product engineer. |
| `bad` | **Not compatible**: it's ruled out and listed with the reason. |

The verdict is the worst state among the checks.

The **level** is the color shown in the comparison:

| Level | Color | Meaning |
|---|---|---|
| `same` | green | Same as the original |
| `minor` | yellow | Differs, without impact on the design |
| `unknown` | grey | Not listed for one of the two parts |
| `critical` | red | Needs a product engineer, or rules the part out |

## 2. Substitution rules

| Spec | Rule | Code |
|---|---|---|
| Capacitance | Must match exactly, otherwise `bad`. Candidates are first narrowed to the same capacitance. | `evaluate()`, `rank()` |
| Case size | Must match, otherwise `bad` (the footprint won't fit). If the original has no case (a description search), `warn`. | `evaluate()` |
| Height (max) | Same height: `ok`. Different height in the same case: `info` (and a review flag, §3). Either height unknown: `info`, grey. | `evaluate()` |
| Rated voltage | Equal: `ok`. Higher: `warn`, and counted as an upgrade (it's a different design, often taller, with a different DC-bias curve). Lower: `bad`. Original unknown: `warn`. | `evaluate()` |
| Dielectric | Ranked Y5V < X5R < X7R < C0G. Equal: `ok`. Higher: `warn`, and counted as an upgrade. Lower: `bad`. Unknown: `warn`. A dielectric outside this ranking (X6S, X7S, X8R) isn't ranked, so the part is counted as *missing specs* instead of being judged. | `evaluate()`, `isCheckable()` |
| Operating temperature | Taken from the dielectric (X7R and C0G: −55 to 125 °C; X5R: −55 to 85 °C; Y5V: −30 to 85 °C). Same or wider: `ok`. Narrower: `bad`. | `evaluate()` |
| Tolerance | Equal: `ok`. Tighter: `ok` minor, counted as an upgrade. Looser: `bad`. Candidate unlisted: `warn`. Original unlisted: `info`. | `evaluate()` |
| Grade | Grades aren't a ladder. AEC-Q200 satisfies commercial. Only a medical-grade series satisfies medical. Commercial satisfies only commercial. Not met: `bad`. Above the requirement: `ok` minor, counted as an upgrade. | `meetsGrade()`, `evaluate()` |
| Termination | Automotive: replacing flexible (soft) termination with standard, or with an unlisted termination, is `warn` (risk of board-flex cracking). Outside automotive the same change is `info`. Gaining flexible termination is `ok` minor, counted as an upgrade. | `evaluate()` |
| Lifecycle | EOL: `bad`. NRND: `warn`. Active: `ok`. Unverified: `info`. | `evaluate()` |
| Manufacturer | Always `info`: same manufacturer (already on the AML), new manufacturer (needs an AML entry), or unknown. It never changes the verdict; it shapes the approval path (§4). | `evaluate()` |

**Better than original** keeps only passing candidates with at least one upgrade. They are sorted by number of upgrades, then by the ranking in §6 (`rank()`).

## 3. Engineering-review flags

Some risks aren't a pass or fail on the datasheet. Each candidate lists them for the engineer, with no calculation (`reviewFlags()` in `js/rules.js`).

Flags **never** rule a part out or change its verdict. Among otherwise equal candidates, fewer flags rank first (`rank()`).

| Flag | Raised when | Why |
|---|---|---|
| **DC bias** | The candidate is class II (X5R, X7R or Y5V) and isn't the same design as the original. Same design means same manufacturer, rated voltage, dielectric and a known, equal height. Y5V is always flagged. Never raised for C0G. | Class II ceramics lose capacitance under DC voltage. The loss curve depends on manufacturer, rated voltage and height, so two parts with the same label can deliver different capacitance at the circuit's working voltage. |
| **Height** | Both heights are known and differ, or a height is unknown and the rated voltage changes. | The same case size comes in several thicknesses. A taller part can change stencil and placement, and clearance under shields, connectors or a housing. |
| **Termination** | Automotive grade required, and the candidate's termination differs from the original's or isn't listed. | Flexible (soft) termination absorbs board flex near connectors, edges and screw holes. That flex cracks standard MLCCs. |

## 4. Approval path and type of change

The steps a candidate needs before production, with typical durations (`APPROVAL_STEPS`, `approvalPath()`):

| Step | When | Weeks |
|---|---|---|
| Engineering review | The verdict is *needs review* | 2 |
| Samples and build validation | New manufacturer (or unknown, for a description search) | 3 |
| PPAP and customer approval | Automotive grade required | 6 |
| AML and ERP item master entry | Always | 1 |

The **type of change** follows from those steps (`changeType()`):
- **Major:** engineering review or PPAP.
- **Minor:** samples from a new manufacturer.
- **Drop-in:** the AML entry only.

The durations are assumptions; they vary by company and customer.

## 5. Supply, production date and cost

- **Supply** (`supplyPlan()`): "now" if stock covers the quantity, or, with no quantity, if there is any stock. Otherwise it's the factory lead time. With no lead time, the supply date is **unknown** and is never guessed.
- **Usable in production** (`plan()`): the later of supply and approval, assuming you order while approval runs. With a need date, the candidate is on time or *n* weeks late. For a part-number search, the original's own date is the baseline: what waiting would cost.
- **Live price** (`bestOffer()`, `orderQuantity()`, `unitPriceAt()`):
  - The quantity is rounded up to the offer's MOQ and order multiple, then priced at the highest price break at or below it.
  - Among USD offers, those whose stock covers the order come first, then the lowest total spend.
- **Cost** (`costPlan()`): unit price, total for the quantity, and the difference against the original.

## 6. Ranking

Equivalent mode (`rank()`):
1. Usable by the need date, when a date is given.
2. Smallest type of change: drop-in, then minor, then major.
3. Verdict: passes before needs review.
4. Fewer engineering-review flags.
5. Soonest usable in production.
6. Shortest lead time, then most stock.

## 7. Where the specs come from

| Source | How | Code |
|---|---|---|
| Demo catalog | 31 MLCCs with hand-entered specs. Stock, lead time and price are simulated. Height and termination are read from the part number. | `CATALOG` in `js/rules.js` |
| Nexar (Octopart) | Specs from the part's attributes. Offers from authorised sellers. | `fromNexar()` in `worker/src/parts.js` |
| Mouser | Specs from the description text, for example "0603 0.1uF 50volts X7R 10%". | `fromMouser()`, `parseCapacitance()` and the other `parse…()` functions in `worker/src/parts.js` |
| Part number | Fills only the specs a listing leaves out; the listing's own value always wins. Height and termination always come from here. Formats: Murata (GRM, GCM, GCJ, GRJ…), Samsung (CL), TDK (C, CGA), KEMET (C…C/X), Yageo (CC/AC) and KYOCERA AVX. An unknown code stays empty. | `decodeMpn()`, `fillFromMpn()`, `eiaCap()` in `js/mpn.js` |
| Offline fallback | If live data doesn't answer within 5 s and the part isn't in the demo catalog, a readable part number becomes a spec matched against the demo catalog. Stock, lead time and price stay unknown. | `specFromPartNumber()` in `js/rules.js`, `search()` in `js/app.js` |

Missing data stays missing. A part without capacitance, case, voltage or a ranked dielectric isn't judged; it's counted as *missing specs* (`isCheckable()`).

## 8. Dates and quantities

- **Dates** always read as `9 Nov 2026`, with the ISO week where it helps (`fmtDate()`, `fmtWeek()`).
- **The need date** (`parseNeedDate()`) accepts:
  - `9 Dec 2026`, `Dec 9, 2026`, `2026-12-09`
  - planning weeks: `wk 50`, `W2 2027`

  A missing year means the next such date. All-number dates like `12/09/2026` are refused as ambiguous: they read as 9 Dec in the US and 12 Sep elsewhere.
- **Quantities** (`parseQty()`) accept `250000`, `250,000`, `250k` or `1.2M`.

## 9. Exchange rates

Prices are quoted in USD. MXN and EUR use the European Central Bank reference rate, for information only.
- The Worker fetches the rate from Frankfurter, validates it and caches it for 6 hours (`fxRates()` in `worker/src/index.js`, `parseRates()` in `js/fx.js`).
- An implausible answer becomes an error, never a rate.
