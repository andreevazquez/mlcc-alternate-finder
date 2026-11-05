// DOM rendering and wiring. All substitution logic lives in rules.js.
import {
  CATALOG, BY_PN, CAP_VALUES, GRADES, CHECK_ROWS,
  fmtCap, fmtTol, fmtVolt, fmtStock, fmtWeek, addWeeks, parseQty, parseQuery, rank, liveSources, priceLive, safeUrl
} from "./rules.js?v=2";
import {FX_URL, FX_SOURCE, CURRENCIES, parseRates, convert, crossRates} from "./fx.js?v=2";

// The Cloudflare Worker in worker/ that returns live part data. Empty: the page uses only the
// demo catalog, as before. Set it to the Worker's URL once it's deployed.
const API_URL = "https://mlcc-alternate-finder-api.ricardovazqueztovar.workers.dev";
const MPN_RE = /^[A-Za-z0-9][A-Za-z0-9\-./#+]{2,59}$/;

const EXAMPLES = [
  {label:"Compare 0.1 µF options, 250k needed in 4 weeks", query:"0.1uF 50V X7R 0603", mode:"equivalent", grade:"same", qty:"250k", weeks:4},
  {label:"10 µF from a BOM line, better than",  query:"CAP CER 10UF 10V X5R 0805",   mode:"better",     grade:"same"},
  {label:"Automotive grade, 50k in 12 weeks", query:"0.1uF 50V X7R 0603 AEC-Q200", mode:"equivalent", grade:"automotive", qty:"50k", weeks:12},
  {label:"100 pF for a medical device",         query:"100pF 50V C0G 0603",          mode:"equivalent", grade:"medical"}
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = id => document.getElementById(id);
// Links to live price, stock and MOQ for a part, opened in a new tab.
const liveLinks = pn => `
  <p class="live"><span class="live-label">Live price, stock and MOQ:</span> ${liveSources(pn).map(s =>
    `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${s.name}<span class="sr-only"> (opens in a new tab)</span></a>`).join("")}</p>`;


const SOURCE_NAME = {Nexar:"Octopart (Nexar)", Mouser:"Mouser"};
function fmtAgo(iso){
  const min = Math.max(0, Math.round((Date.now() - new Date(iso)) / 6e4));
  if (!Number.isFinite(min)) return "";
  if (min < 2) return "just now";
  if (min < 60) return `${min} min ago`;
  if (min < 48 * 60) return `${Math.round(min / 60)} h ago`;
  return `${Math.round(min / 1440)} d ago`;
}
const leadText = w => w == null ? "Not listed" : `${w} wk`;
const priceOr = (usd, rate, d, none = "No price listed") => usd == null ? none : money(usd, rate, d);

// Live offers for the original, one row per distributor offer, the quoted one marked.
function renderOffers(o, rate){
  const offers = o.offers || [];
  if (!offers.length) return `<p class="hint">No distributor lists stock or prices for this part.</p>`;
  const quoted = o.quote?.offer;
  const rows = offers.map(f => {
    const q = f === quoted ? o.quote : null;
    const breaks = (f.priceBreaks || []).filter(b => b.currency === "USD");
    const from = breaks.length ? `from ${breaks[0].qty.toLocaleString("en-US")}: ${money(breaks[0].price, rate, 4)}` : "No USD price";
    return `<tr${q ? ` class="quoted"` : ""}>
      <th scope="row">${safeUrl(f.url) ? `<a href="${esc(safeUrl(f.url))}" target="_blank" rel="noopener noreferrer nofollow">${esc(f.seller || "Distributor")}<span class="sr-only"> (opens in a new tab)</span></a>` : esc(f.seller || "Distributor")}${f.sku ? `<span class="cell-note">${esc(f.sku)}</span>` : ""}</th>
      <td>${fmtStock(f.stock)}</td>
      <td>${f.moq == null ? "—" : f.moq.toLocaleString("en-US")}${f.multiple > 1 ? `<span class="cell-note">multiples of ${f.multiple.toLocaleString("en-US")}</span>` : ""}</td>
      <td>${leadText(f.leadWeeks)}</td>
      <td>${esc(f.packaging || "—")}</td>
      <td>${q ? `${money(q.unit, rate, 4)}<span class="cell-note">quoted for ${q.orderQty.toLocaleString("en-US")}</span>` : esc(from)}</td>
    </tr>`;
  }).join("");
  return `
    <div class="cmp-wrap" role="region" aria-labelledby="offers-cap" tabindex="0">
      <table class="cmp offers">
        <caption id="offers-cap">Distributor offers</caption>
        <thead><tr><th scope="col">Distributor</th><th scope="col">Stock</th><th scope="col">MOQ</th><th scope="col">Lead time</th><th scope="col">Packaging</th><th scope="col">Unit price</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

// Comparison colors: green same, yellow differs without impact, red needs a product engineer.
const MARK = {same:"✓", minor:"≈", critical:"!"};
const LEVEL_SR = {same:"Same", minor:"Minor difference", critical:"Product engineer review"};
const LEVEL_CHIP = {same:"v-ok", minor:"v-warn", critical:"v-bad"};
let current = null;

const num = (n, d) => n.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
// Prices are quoted in USD. rate is null for USD, or {cur, k} to show the price in MXN or EUR
// at k per USD first, with the USD figure after it.
const inCur = (usd, rate, d) => `${CURRENCIES[rate.cur].symbol}${num(usd * rate.k, rate.cur === "MXN" && d === 4 ? 3 : d)}`;
function money(usd, rate, d){
  const s = `US$${num(usd, d)}`;
  return rate ? `${inCur(usd, rate, d)} · ${s}` : s;
}
// Same, for the comparison table: the USD figure on its own line so columns stay narrow.
function moneyCell(usd, rate, d, sign = false){
  const lead = sign ? (usd > 0 ? "+" : usd < 0 ? "−" : "±") : "";
  const v = sign ? Math.abs(usd) : usd;
  return rate
    ? `${lead}${inCur(v, rate, d)}<span class="alt-cur">${lead}US$${num(v, d)}</span>`
    : `${lead}US$${num(v, d)}`;
}
const signedMoney = (usd, rate, d) => (usd > 0 ? "+" : usd < 0 ? "−" : "±") + money(Math.abs(usd), rate, d);
const pct = x => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.round(Math.abs(x) * 100)}%`;

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function getOptions(){
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const grade = $("grade").value;
  const qty = parseQty($("qty").value);
  const [y, m, d] = $("need").value.split("-").map(Number);
  const needBy = y ? new Date(y, m - 1, d) : null;
  const cur = $("cur").value;
  const rate = cur !== "USD" && fx.rates ? {cur, k: fx.rates.perUsd[cur]} : null;
  return {mode, grade, qty, rate, demand:{qty: Number.isNaN(qty) ? null : qty, needBy, today:today()}};
}

function renderOriginal(o, required, {demand, original}, rate, live){
  const title = o.fromPart
    ? `<div><div class="pn">${esc(o.pn)}</div><div class="maker">${esc(live ? [o.mfr, o.description].filter(Boolean).join(" · ") : `${o.mfr} ceramic capacitor`)}</div></div>`
    : `<div><div class="pn">Spec from your description</div><div class="maker">No part number, so matching on these specs</div></div>`;
  const field = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  const suggestion = live && o.recommendedAlt
    ? `<p class="recommendation"><b>Mouser listing suggests</b> <span class="pn">${esc(o.recommendedAlt)}</span> — not checked for compatibility. <a href="${esc(liveSources(o.recommendedAlt).find(s => s.name === "Mouser").url)}" target="_blank" rel="noopener noreferrer">Check Mouser’s listing<span class="sr-only"> (opens in a new tab)</span></a></p>`
    : "";
  $("orig").innerHTML = `
    <div class="label-top">${title}<div class="barcode" aria-hidden="true"></div></div>
    <dl class="fields">
      ${field("Capacitance", fmtCap(o.cap))}${field("Voltage", fmtVolt(o.v))}
      ${field("Case", o.pkg || "Not specified")}${field("Dielectric", o.diel || "Not specified")}
      ${field("Tolerance", fmtTol(o.tol))}${field("Grade", GRADES[o.grade].label)}
      ${required !== o.grade ? field("Grade required now", GRADES[required].label) : ""}
      ${demand.qty ? field("Quantity needed", fmtStock(demand.qty)) : ""}
      ${demand.needBy ? field("Needed by", fmtWeek(demand.needBy, demand.today)) : ""}
      ${o.fromPart ? field(live ? "Unit price" : "Unit price (simulated)", priceOr(o.usd, rate, 4)) : ""}
      ${o.fromPart && demand.qty && o.usd != null ? field(`Cost for ${fmtStock(demand.qty)}`, money(o.usd * demand.qty, rate, 0)) : ""}
      ${live && o.life ? field("Lifecycle", o.life) : ""}
    </dl>
    ${!o.fromPart ? "" : live ? `
      <p class="shortage">${o.stock == null ? "No distributor lists stock" : o.stock ? `${fmtStock(o.stock)} in stock at authorised distributors` : "No stock at authorised distributors"}, ${
        o.lead == null ? "no factory lead time listed" : `typical factory lead time ${o.lead} wk (median of distributor quotes)`}.${waitText(original, demand)}</p>
      ${suggestion}
      ${renderOffers(o, rate)}
      ${safeUrl(o.datasheet) ? `<p class="live"><a href="${esc(safeUrl(o.datasheet))}" target="_blank" rel="noopener noreferrer nofollow">Datasheet<span class="sr-only"> (opens in a new tab)</span></a></p>` : ""}
      ${liveLinks(o.pn)}`
    : `<p class="shortage">Simulated: ${o.stock ? fmtStock(o.stock) + " in stock" : "no stock"} at distribution, ${o.lead}-week factory lead time.${waitText(original, demand)}</p>${liveLinks(o.pn)}`}`;
}

// What happens if you just wait for the original part.
function waitText(original, demand){
  const {needBy} = demand;
  if (!needBy || original.fromStock || !original.date) return "";
  return original.onTime
    ? ` Waiting for it still makes the need date (${fmtWeek(original.date, demand.today)}).`
    : ` Waiting for it means ${fmtWeek(original.date, demand.today)}, ${original.late} wk late.`;
}

function supplyText(part, {qty}){
  const factory = part.lead == null ? "no factory lead time listed" : `${part.lead} wk from the factory`;
  if (qty == null) return part.stock > 0 ? `from stock (${fmtStock(part.stock)})` : `${part.stock == null ? "no stock listed" : "no stock"}, ${factory}`;
  if (part.stock >= qty) return `from stock, covers all ${fmtStock(qty)}`;
  if (part.stock > 0) return `stock covers ${Math.floor(part.stock / qty * 100)}% now, the rest ${part.lead == null ? "with no lead time listed" : `in ${part.lead} wk`}`;
  return `${part.stock == null ? "no stock listed" : "no stock"}, ${factory}`;
}

function renderPlan(r, demand){
  const {approval, usableDate, onTime, lateWeeks} = r.plan;
  const chip = onTime == null || !usableDate ? "" : onTime
    ? `<span class="verdict v-ok">On time</span>`
    : `<span class="verdict v-warn">${lateWeeks} wk late</span>`;
  return `
    <div class="plan">
      <p class="plan-head"><span>Usable in production <b>${usableDate ? fmtWeek(usableDate, demand.today) : "unknown"}</b></span>${chip}</p>
      <p class="plan-sub">Supply ${esc(supplyText(r.part, demand))}. Approval about ${approval.weeks} wk, run in parallel.</p>
      <details class="path">
        <summary>Approval path: ${approval.steps.length} step${approval.steps.length > 1 ? "s" : ""}, about ${approval.weeks} wk</summary>
        <ol class="steps">${approval.steps.map(s => `<li>${esc(s.text)} <span class="wk">${s.weeks} wk</span></li>`).join("")}</ol>
      </details>
    </div>`;
}

// Side-by-side comparison of the original against the top candidates.
function renderCompare(o, ranking, rate, live){
  const cols = ranking.fits.slice(0, 3);
  if (!cols.length) return "";
  const {demand} = ranking;
  const rows = cols.map(r => Object.fromEntries(r.checks.map(k => [k.key, k])));
  const cell = k => `<td class="lv-${k.level}"><span class="mark" aria-hidden="true">${MARK[k.level]}</span><span class="sr-only">${LEVEL_SR[k.level]}: </span>${esc(k.value)}${
    k.level === "same" || k.key === "life" ? "" : `<span class="cell-note">${esc(k.text)}</span>`}</td>`;
  const plain = (label, orig, cells) => `<tr><th scope="row">${label}</th><td class="orig">${orig}</td>${cells.join("")}</tr>`;
  const sec = label => `<tr class="sec"><th scope="colgroup" colspan="${cols.length + 2}">${label}</th></tr>`;

  const datasheet = CHECK_ROWS.map(key =>
    `<tr><th scope="row">${rows[0][key].label}</th><td class="orig">${esc(rows[0][key].orig)}</td>${rows.map(m => cell(m[key])).join("")}</tr>`).join("");
  const planning = [
    plain("Type of change", "—", cols.map(r =>
      `<td><span class="verdict ${LEVEL_CHIP[r.change.level]}">${r.change.label}</span><span class="cell-note">${esc(r.change.reason)}</span></td>`)),
    plain("Lead time", o.fromPart ? leadText(o.lead) : "—", cols.map(r => `<td>${leadText(r.part.lead)}</td>`)),
    plain("Stock", o.fromPart ? fmtStock(o.stock) : "—", cols.map(r => `<td>${fmtStock(r.part.stock)}</td>`)),
    plain("Usable in production", o.fromPart && ranking.original?.date ? esc(fmtWeek(ranking.original.date, demand.today)) : "—", cols.map(r =>
      `<td>${r.plan.usableDate ? esc(fmtWeek(r.plan.usableDate, demand.today)) : "Unknown"}${r.plan.onTime == null ? "" : `<span class="cell-note">${r.plan.onTime ? "On time" : `${r.plan.lateWeeks} wk late`}</span>`}</td>`)),
    plain(live ? "Unit price" : "Unit price (simulated)", o.fromPart && o.usd != null ? moneyCell(o.usd, rate, 4) : "—", cols.map(r =>
      `<td>${r.cost.unit == null ? "Not listed" : moneyCell(r.cost.unit, rate, 4)}${r.cost.deltaPct == null ? "" : `<span class="cell-note">${pct(r.cost.deltaPct)} vs original</span>`}</td>`)),
    ...(demand.qty ? [plain(`Cost for ${fmtStock(demand.qty)}`, o.fromPart && o.usd != null ? moneyCell(o.usd * demand.qty, rate, 0) : "—", cols.map(r =>
      `<td>${r.cost.total == null ? "Not listed" : moneyCell(r.cost.total, rate, 0)}${r.cost.deltaTotal == null ? "" : `<span class="cell-note">${moneyCell(r.cost.deltaTotal, rate, 0, true).replace('<span class="alt-cur">', " · ").replace("</span>", "")} vs original</span>`}</td>`))] : [])
  ].join("");

  return `
    <h3 class="cmp-h">Side by side: top ${cols.length}</h3>
    <div class="cmp-wrap" role="region" aria-labelledby="cmp-cap" tabindex="0">
      <table class="cmp">
        <caption id="cmp-cap" class="sr-only">Datasheet comparison of the original against the top ${cols.length} candidates</caption>
        <thead><tr><th scope="col">Spec</th><th scope="col">${o.fromPart ? `Original<span class="pn cell-note">${esc(o.pn)}</span>` : "Your spec"}</th>${cols.map(r =>
          `<th scope="col"><span class="pn">${esc(r.part.pn)}</span><span class="cell-note">${esc(r.part.mfr)}</span></th>`).join("")}</tr></thead>
        <tbody>${sec("Datasheet")}${datasheet}${sec("Change, supply and cost")}${planning}</tbody>
      </table>
    </div>
    <p class="hint cmp-note">${live
      ? `Retrieved from ${esc(SOURCE_NAME[live.source] || live.source)} ${esc(fmtAgo(live.fetchedAt))}; this is when the service fetched the response, not necessarily when each supplier updated its listing. Stock and lead times can change. Prices are for the order quantity at the distributor that covers it for the least. Confirm against the current datasheet and supplier listing before approving.`
      : "Specs come from the demo catalog and aren’t all verified against datasheets yet. Stock, lead times and prices are simulated."}</p>`;
}

function emptyMessage({mode, required, ranking, live, o}){
  if (live && o.cap == null) return `${SOURCE_NAME[live.source] || live.source} doesn’t list a capacitance for this part, so alternates can’t be checked. This tool checks ceramic capacitors (MLCC).`;
  if (live && live.alternatesError) return `Alternates couldn’t be searched: ${live.alternatesError}. Try again in a moment.`;
  if (required === "medical"){
    return `No part ${live ? "found" : "in this demo catalog"} is released for medical use. A medical design needs the manufacturer’s medical-grade series, and life-support or implantable use usually needs the manufacturer’s written approval. AEC-Q200 doesn’t substitute for either.`;
  }
  if (mode === "better"){
    return ranking.equivalentOnly
      ? `Nothing here beats the original without giving something up. ${ranking.equivalentOnly} part${ranking.equivalentOnly > 1 ? "s match" : " matches"} it exactly; switch to “Equivalent” to see ${ranking.equivalentOnly > 1 ? "them" : "it"}.`
      : "Nothing here beats the original without giving something up. Check the ruled-out list for near misses.";
  }
  return "A near miss below might still work with an engineering deviation. Open the ruled-out list to see what failed.";
}

function renderCandidates(o, ranking, {mode, required, rate, live}){
  const {fits, ruledOut, dropIns, minor, major, equivalentOnly, unchecked, demand, onTime} = ranking;
  $("cand-h").textContent = fits.length
    ? (mode === "better" ? "Better than the original, most upgrades first" : "Candidates, best first")
    : live && o.cap == null ? "Alternates can’t be checked yet"
    : live?.alternatesError ? "Live alternate search unavailable"
    : required === "medical" ? (live ? "No live medical-grade candidate found" : "No medical-grade parts in demo catalog")
    : mode === "better" ? "No upgrade found" : "No candidate fits every rule";

  const tally = [];
  if (onTime != null)  tally.push(`<li class="v-neutral">${onTime} usable by ${fmtWeek(demand.needBy, demand.today)}</li>`);
  if (dropIns)         tally.push(`<li class="v-ok">${dropIns} drop-in</li>`);
  if (minor)           tally.push(`<li class="v-warn">${minor} minor change</li>`);
  if (major)           tally.push(`<li class="v-bad">${major} major change</li>`);
  if (equivalentOnly)  tally.push(`<li class="v-neutral">${equivalentOnly} equivalent only</li>`);
  if (ruledOut.length) tally.push(`<li class="v-neutral">${ruledOut.length} ruled out</li>`);
  if (unchecked)       tally.push(`<li class="v-neutral">${unchecked} missing specs</li>`);
  $("tally").innerHTML = tally.join("");

  const dated = fits.filter(r => r.plan.usableDate);
  const earliest = dated.length ? dated.reduce((a, b) => b.plan.usableDate < a.plan.usableDate ? b : a) : null;
  const lateNote = onTime === 0 && earliest
    ? `<p class="empty lead-note">None of these can be approved and in hand by ${fmtWeek(demand.needBy, demand.today)}. The earliest is ${esc(earliest.part.pn)}, usable ${fmtWeek(earliest.plan.usableDate, demand.today)}.</p>`
    : "";
  const legend = fits.length ? `
    <ul class="legend" aria-label="Color key">
      <li><span class="sw sw-same" aria-hidden="true">✓</span>Same</li>
      <li><span class="sw sw-minor" aria-hidden="true">≈</span>Differs, no impact</li>
      <li><span class="sw sw-critical" aria-hidden="true">!</span>Needs a product engineer</li>
    </ul>` : "";
  $("cand-body").innerHTML = fits.length
    ? `${lateNote}${legend}${renderCompare(o, ranking, rate, live)}<h3 class="cmp-h">All candidates</h3><ol class="tape" aria-label="${mode === "better" ? "Upgrades ranked by number of improvements" : demand.needBy ? "Candidates ranked by on-time, fit, then usable date" : "Candidates ranked by fit, then usable date"}">${fits.map(r => `
        <li class="pocket">
          <div class="pocket-head">
            <h3><span class="pn">${esc(r.part.pn)}</span> <span class="maker">${esc(r.part.mfr)}</span></h3>
            <span class="verdict ${LEVEL_CHIP[r.change.level]}">${r.change.label}</span>
          </div>
          <p class="change-why">${esc(r.change.reason)}</p>
          ${r.upgrades.length ? `<p class="better">Better on: ${r.upgrades.map(esc).join(", ")}</p>` : ""}
          <ul class="checks">${r.checks.map(k => `
            <li><span class="mark m-${k.level}" aria-hidden="true">${MARK[k.level]}</span><span><span class="sr-only">${LEVEL_SR[k.level]}: </span>${esc(k.text)}</span></li>`).join("")}
          </ul>
          ${renderPlan(r, demand)}
          <p class="avail"><span>Stock <b>${fmtStock(r.part.stock)}</b></span><span>Lead time <b>${leadText(r.part.lead)}</b></span><span>Unit price <b>${priceOr(r.cost.unit, rate, 4, "not listed")}</b>${r.cost.deltaPct == null ? "" : ` (${pct(r.cost.deltaPct)})`}</span>${
            demand.qty && r.cost.total != null ? `<span>Cost for ${fmtStock(demand.qty)} <b>${money(r.cost.total, rate, 0)}</b>${r.cost.deltaTotal == null ? "" : ` (${signedMoney(r.cost.deltaTotal, rate, 0)})`}</span>` : ""}</p>
          ${liveLinks(r.part.pn)}
        </li>`).join("")}</ol>`
    : `<p class="empty">${esc(emptyMessage({mode, required, ranking, live, o}))}</p>`;
  const uncheckedNote = unchecked
    ? `<p class="hint">${unchecked} other part${unchecked > 1 ? "s" : ""} with the same capacitance ${unchecked > 1 ? "don’t" : "doesn’t"} list voltage, case or a supported dielectric, so ${unchecked > 1 ? "they aren’t" : "it isn’t"} shown.</p>` : "";
  $("cand-body").insertAdjacentHTML("beforeend", uncheckedNote);

  $("ruled-wrap").hidden = !ruledOut.length;
  $("ruled-wrap").open = !fits.length && mode !== "better" && required !== "medical";
  $("ruled-sum").textContent = `Ruled out (${ruledOut.length})`;
  $("ruled").innerHTML = ruledOut.map(r => `
    <li><span class="pn">${esc(r.part.pn)}</span> <span class="maker">${esc(r.part.mfr)}</span>
    <span class="why">${r.fails.map(esc).join("; ")}</span></li>`).join("");

  return `${fits.length} shown, ${ruledOut.length} ruled out.${onTime != null ? ` ${onTime} usable by the need date.` : ""}`;
}

function setHash(o){
  const url = location.pathname + location.search + (o.fromPart ? "#" + o.pn : "");
  if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
}

function showError(msg){
  $("q-err").textContent = msg;
  $("q-err").hidden = false;
  $("q").setAttribute("aria-invalid", "true");
}
function clearError(){
  $("q-err").hidden = true;
  $("q").removeAttribute("aria-invalid");
}

/* ---------- Live data ---------- */
// A query goes to the Worker when it's a single part-number-like word that isn't a description
// ("100nF" parses as one; "GRM188R71H104KA93D" or an unknown MPN doesn't).
function liveMpn(query, parsed){
  const q = query.trim();
  if (!API_URL || /\s/.test(q) || !MPN_RE.test(q)) return null;
  if (parsed.spec) return parsed.spec.fromPart ? parsed.spec.pn : null;
  return q.toUpperCase();
}

const liveCache = new Map(); // mpn -> Promise of {data} or {error}
function fetchLive(mpn){
  if (!liveCache.has(mpn)){
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 15000);
    liveCache.set(mpn, fetch(`${API_URL}/part?mpn=${encodeURIComponent(mpn)}`, {signal: ctl.signal})
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`the live-data service answered ${r.status}`)))
      .then(data => {
        if (!data.part) liveCache.delete(mpn); // not found or failed: ask again next time
        return {data};
      })
      .catch(e => { liveCache.delete(mpn); return {error: e.name === "AbortError" ? "the live-data service took too long" : e.message || "the live-data service couldn’t be reached"}; })
      .finally(() => clearTimeout(timer)));
  }
  return liveCache.get(mpn);
}

// Why there's no live part, in one sentence.
function liveProblem(mpn, {data, error}){
  if (error) return `Live data isn’t available right now (${error}).`;
  const errs = data.errors || {};
  const reasons = [errs.Nexar, errs.Mouser].filter(Boolean);
  if (errs.planLimit && !data.part) return `Nexar’s plan limits this lookup; check the account’s result limit or use the Mouser fallback. ${reasons.filter(e => !/plan limits/i.test(e)).join("; ")}`.trim();
  if (errs.quota && !data.part) return "Live data isn’t available: this month’s Octopart (Nexar) quota is used up and Mouser didn’t answer either.";
  if (errs.rateLimit && !data.part) return `Nexar temporarily rate-limited this lookup; retry shortly. ${reasons.filter(e => !/rate-limited/i.test(e)).join("; ")}`.trim();
  if (reasons.length && reasons.every(e => /doesn’t list/.test(e)))
    return `No authorised distributor lists ${mpn}. Check the part number.`;
  return `Live data isn’t available right now (${reasons.join("; ") || "no source answered"}).`;
}

function setNote(html){
  $("source-note").innerHTML = html;
  $("source-note").hidden = !html;
}

let seq = 0;
async function search(query, {focusResults = true} = {}){
  const parsed = parseQuery(query);
  const mpn = liveMpn(query, parsed);
  let live = null, problem = null;
  const mine = ++seq;
  if (mpn){
    clearError();
    $("status").textContent = `Looking up ${mpn}…`;
    $("search-form").setAttribute("aria-busy", "true");
    const res = await fetchLive(mpn);
    if (mine !== seq) return; // a newer search started meanwhile
    $("search-form").removeAttribute("aria-busy");
    if (res.data?.part) live = res.data;
    else problem = liveProblem(mpn, res);
  }
  if (!live && parsed.error){
    showError(problem ? `${problem} ${parsed.error.replace(/ Describe it instead/, " You can describe it instead")}` : parsed.error);
    $("status").textContent = "";
    return;
  }
  clearError();
  current = {query, parsed, live, problem};
  render(current, {focusResults});
}

function render({query, parsed, live, problem}, {focusResults}){
  const {mode, grade, qty, rate, demand} = getOptions();
  const qtyBad = Number.isNaN(qty);
  $("qty-err").hidden = !qtyBad;
  $("qty-err").textContent = qtyBad ? "Enter the quantity as a number, like 250000 or 250k. Results below ignore it." : "";
  if (qtyBad) $("qty").setAttribute("aria-invalid", "true"); else $("qty").removeAttribute("aria-invalid");

  // Live: price every part for this quantity. Demo: the catalog as it is.
  const spec = live ? {...priceLive(live.part, demand.qty), fromPart:true} : parsed.spec;
  const candidates = live ? live.candidates.map(c => priceLive(c, demand.qty)) : CATALOG;
  const source = live ? SOURCE_NAME[live.source] || live.source : null;
  const providerNote = live?.errors?.planLimit
    ? live.alternatesSource === "Mouser" || live.source === "Mouser"
      ? ". Nexar’s plan limit restricted results; Mouser supplied the fallback."
      : ". Nexar’s plan limit restricted results."
    : live?.errors?.quota
      ? ". Octopart’s monthly quota is used up; fallback data may be incomplete."
      : live?.errors?.rateLimit
        ? ". Nexar temporarily rate-limited requests; retry shortly."
      : "";
  setNote(live
    ? `<span class="src-live">Live</span> ${esc(source)} · ${esc(fmtAgo(live.fetchedAt))}${providerNote}${
        live.alternatesSource && live.alternatesSource !== live.source ? `. Alternates from ${esc(SOURCE_NAME[live.alternatesSource] || live.alternatesSource)}.` : ""}`
    : problem
      ? `<span class="src-demo">Demo</span> ${esc(problem)} Showing the demo catalog instead: stock, lead times and prices are simulated.`
      : API_URL && !parsed.spec?.fromPart
        ? `<span class="src-demo">Demo</span> Descriptions are matched against the demo catalog; enter a manufacturer part number for live data.`
        : "");

  const required = grade === "same" ? spec.grade : grade;
  const ranking = rank(spec, {mode, required, demand, candidates});
  renderOriginal(spec, required, ranking, rate, live);
  const summary = renderCandidates(spec, ranking, {mode, required, rate, live});
  $("results").hidden = false;
  setHash(spec);
  $("status").textContent = (live ? `Live data from ${source}. ` : "") + summary;

  if (focusResults){
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("orig-h").scrollIntoView({behavior: reduce ? "auto" : "smooth", block:"start"});
    $("cand-h").focus({preventScroll:true});
  }
}

/* ---------- Exchange rates ---------- */
// Loaded once per visit. If they can't be loaded, prices stay in USD and the panel says why.
const fx = {rates: null};
const CUR_KEY = "mlcc.currency";
const store = {
  get(){ try { return localStorage.getItem(CUR_KEY); } catch { return null; } },
  set(v){ try { localStorage.setItem(CUR_KEY, v); } catch { /* private mode: not remembered */ } }
};
const fmtRate = r => num(r, 4);
const fmtFxDate = iso => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {day:"numeric", month:"short", year:"numeric", timeZone:"UTC"});

function renderConverter(){
  const amt = Number($("fx-amt").value.trim().replace(/,/g, ""));
  const from = $("fx-from").value;
  const out = $("fx-out");
  if (!fx.rates) { out.textContent = ""; return; }
  if (!Number.isFinite(amt) || amt < 0){ out.textContent = "Enter an amount, like 1000."; return; }
  const sym = c => CURRENCIES[c].symbol;
  out.textContent = `${sym(from)}${num(amt, 2)} = ` + Object.keys(CURRENCIES).filter(c => c !== from)
    .map(c => `${sym(c)}${num(convert(amt, from, c, fx.rates.perUsd), 2)}`).join(" · ");
}

function renderFx(){
  const status = $("fx-status");
  if (!fx.rates){
    status.textContent = "Couldn’t load today’s exchange rates, so prices are shown in USD only. Reload the page to try again.";
    status.classList.add("fx-error");
    return;
  }
  status.classList.remove("fx-error");
  status.textContent = `${FX_SOURCE}, ${fmtFxDate(fx.rates.date)}. Updated once per working day; for information only, not a bank or customs rate.`;
  $("fx-rates").innerHTML = crossRates(fx.rates.perUsd)
    .filter(x => x.from !== "MXN")
    .map(x => `<li><span class="fx-pair">1 ${x.from}</span> = <b>${esc(fmtRate(x.rate))}</b> ${x.to}</li>`).join("");
  $("fx-rates").hidden = false;
  $("fx-conv").hidden = false;
  renderConverter();
}

async function loadRates(){
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    // no-cache: revalidate with Frankfurter on each visit instead of trusting a day-old copy.
    const res = await fetch(FX_URL, {signal: ctl.signal, cache: "no-cache"});
    fx.rates = res.ok ? parseRates(await res.json()) : null;
  } catch {
    fx.rates = null;
  } finally {
    clearTimeout(timer);
  }
  for (const opt of $("cur").options) opt.disabled = opt.value !== "USD" && !fx.rates;
  const saved = store.get();
  if (fx.rates && saved && CURRENCIES[saved]) $("cur").value = saved;
  if (!fx.rates) $("cur").value = "USD";
  renderFx();
  if (current) render(current, {focusResults:false});
}

/* ---------- Wiring ---------- */
function setOptions({mode, grade, qty = "", weeks = null}){
  // The display currency is the viewer's own; examples leave it as it is.
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  $("grade").value = grade;
  $("qty").value = qty;
  $("need").value = weeks ? isoDate(addWeeks(today(), weeks)) : "";
}

function init(){
  $("parts").innerHTML = CATALOG.map(p =>
    `<option value="${p.pn}">${esc(`${p.mfr} ${fmtCap(p.cap)} ${p.v} V ${p.pkg} ${p.diel}${p.grade === "automotive" ? " AEC-Q200" : ""}`)}</option>`).join("");
  $("q-hint").textContent = API_URL
    ? `Any manufacturer part number gets live specs, stock and prices from authorised distributors. Descriptions are matched against a ${CATALOG.length}-part demo catalog (${CAP_VALUES.map(fmtCap).join(", ")}).`
    : `Demo catalog: ${CATALOG.length} parts, ${CAP_VALUES.map(fmtCap).join(", ")}.`;
  $("examples").innerHTML = EXAMPLES.map((ex, i) =>
    `<li><button type="button" data-i="${i}">${esc(ex.label)}</button></li>`).join("");

  $("search-form").addEventListener("submit", e => { e.preventDefault(); search($("q").value); });
  $("q").addEventListener("input", () => { if (!$("q-err").hidden) clearError(); });
  // Changing what you're looking for re-runs the last search in place.
  $("search-form").addEventListener("change", e => {
    if (e.target.id === "cur") store.set(e.target.value);
    if (e.target.id === "q" || e.target.closest(".fx") || !current) return;
    render(current, {focusResults:false});
  });
  $("examples").addEventListener("click", e => {
    const btn = e.target.closest("button[data-i]");
    if (!btn) return;
    const ex = EXAMPLES[btn.dataset.i];
    setOptions(ex);
    $("q").value = ex.query;
    search(ex.query);
  });

  // A shared link like …#GRM188R71H104KA93D opens straight to that part.
  const fromHash = () => {
    // A malformed hash such as "#%" must not stop the page, so decoding errors are ignored.
    let pn;
    try { pn = decodeURIComponent(location.hash.slice(1)).trim().toUpperCase(); } catch { return; }
    const shown = current && (current.live?.part.pn || current.parsed.spec?.pn);
    if ((BY_PN.has(pn) || (API_URL && MPN_RE.test(pn))) && shown?.toUpperCase() !== pn){
      $("q").value = pn;
      search(pn, {focusResults:false});
    }
  };
  addEventListener("hashchange", fromHash);
  fromHash();

  // The converter is separate from the search: typing in it never submits the form.
  $("fx-amt").addEventListener("input", renderConverter);
  $("fx-from").addEventListener("change", renderConverter);
  $("fx-amt").addEventListener("keydown", e => { if (e.key === "Enter") e.preventDefault(); });
  loadRates();
}

init();
