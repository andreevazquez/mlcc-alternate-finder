// DOM rendering and wiring. All substitution logic lives in rules.js.
import {
  CATALOG, BY_PN, CAP_VALUES, GRADES, CHECK_ROWS,
  fmtCap, fmtTol, fmtVolt, fmtStock, fmtWeek, addWeeks, parseQty, parseQuery, rank, liveSources
} from "./rules.js";
import {fetchLive, fromWorker, sourceLabel} from "./live.js";

// The deployed Worker in worker/. Empty until it's deployed: the page then uses the demo catalog only.
const WORKER_URL = "";
// Local testing only: on localhost, ?api=http://localhost:8787 points the page at `wrangler dev`.
const API = (() => {
  try {
    const u = new URLSearchParams(location.search).get("api");
    return u && /^(localhost|127\.0\.0\.1)$/.test(location.hostname) ? u : WORKER_URL;
  } catch { return WORKER_URL; }
})();
// Worker answers by MPN, so changing options re-prices without asking again.
const liveCache = new Map();
let searchSeq = 0;
// A single token that could be a manufacturer part number, not a value like "100nF".
const isMpnLike = q => {
  const t = q.trim().toUpperCase();
  return /^[A-Z0-9][A-Z0-9\-./#+]{5,59}$/.test(t) && /\d/.test(t) && /[A-Z]/.test(t)
    && !/^\d+(\.\d+)?\s*[PNU]F?$/.test(t);
};

const EXAMPLES = [
  {label:"0.1 µF out of stock, 250k needed in 4 weeks", query:"GRM188R71H104KA93D", mode:"equivalent", grade:"same", qty:"250k", weeks:4},
  {label:"10 µF from a BOM line, better than",  query:"CAP CER 10UF 10V X5R 0805",   mode:"better",     grade:"same"},
  {label:"Moving to automotive, 50k in 12 weeks", query:"GRM188R71H104KA93D",        mode:"equivalent", grade:"automotive", qty:"50k", weeks:12},
  {label:"100 pF for a medical device",         query:"100pF 50V C0G 0603",          mode:"equivalent", grade:"medical"}
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = id => document.getElementById(id);
// Links to live price, stock and MOQ for a part, opened in a new tab.
const liveLinks = pn => `
  <p class="live"><span class="live-label">Live price, stock and MOQ:</span> ${liveSources(pn).map(s =>
    `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${s.name}<span class="sr-only"> (opens in a new tab)</span></a>`).join("")}</p>`;

// Comparison colors: green same, yellow differs without impact, red needs a product engineer.
const MARK = {same:"✓", minor:"≈", critical:"!"};
const LEVEL_SR = {same:"Same", minor:"Minor difference", critical:"Product engineer review"};
const LEVEL_CHIP = {same:"v-ok", minor:"v-warn", critical:"v-bad"};
let current = null;

const num = (n, d) => n.toLocaleString("en-US", {minimumFractionDigits:d, maximumFractionDigits:d});
// Prices are in USD; with an exchange rate, MXN follows.
function money(usd, rate, d){
  if (usd == null) return "Not listed";
  const s = `US$${num(usd, d)}`;
  return rate ? `${s} · MX$${num(usd * rate, d === 4 ? 3 : d)}` : s;
}
// Same, for the comparison table: pesos on their own line so columns stay narrow.
function moneyCell(usd, rate, d, sign = false){
  if (usd == null) return "Not listed";
  const lead = sign ? (usd > 0 ? "+" : usd < 0 ? "−" : "±") : "";
  const a = Math.abs(usd);
  return `${lead}US$${num(sign ? a : usd, d)}${rate ? `<span class="mxn">${lead}MX$${num((sign ? a : usd) * rate, d === 4 ? 3 : d)}</span>` : ""}`;
}
const signedMoney = (usd, rate, d) => (usd > 0 ? "+" : usd < 0 ? "−" : "±") + money(Math.abs(usd), rate, d);
const pct = x => `${x > 0 ? "+" : x < 0 ? "−" : "±"}${Math.round(Math.abs(x) * 100)}%`;

const today = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
const weeksText = w => w == null ? "Not listed" : `${w} wk`;
const dateText = (d, ref) => d ? fmtWeek(d, ref) : "Unknown";
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const isoDate = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function getOptions(){
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const grade = $("grade").value;
  const qty = parseQty($("qty").value);
  const [y, m, d] = $("need").value.split("-").map(Number);
  const needBy = y ? new Date(y, m - 1, d) : null;
  const rateRaw = $("rate").value.trim().replace(",", ".");
  const rate = rateRaw === "" ? null : Number(rateRaw) > 0 ? Number(rateRaw) : NaN;
  return {mode, grade, qty, rate, demand:{qty: Number.isNaN(qty) ? null : qty, needBy, today:today()}};
}

// Live offers for the original, one row per distributor offer, priced at the order quantity.
function renderOffers(o, rate){
  if (!o.offers?.length) return `<p class="hint">${esc(o.source)} lists no authorised offers for this part.</p>`;
  const rows = o.offers.map(f => `<tr>
      <th scope="row">${f.url ? `<a href="${esc(f.url)}" target="_blank" rel="noopener noreferrer">${esc(f.distributor || "Unknown")}<span class="sr-only"> (opens in a new tab)</span></a>` : esc(f.distributor || "Unknown")}${f.sku ? `<span class="cell-note">${esc(f.sku)}</span>` : ""}</th>
      <td>${fmtStock(f.stock)}</td>
      <td>${f.moq == null ? "Not listed" : fmtStock(f.moq)}${f.multiple > 1 ? `<span class="cell-note">multiples of ${fmtStock(f.multiple)}</span>` : ""}</td>
      <td>${esc(f.packaging || "Not listed")}</td>
      <td>${weeksText(f.leadWeeks)}</td>
      <td>${fmtStock(f.quote.orderQty)}</td>
      <td>${moneyCell(f.quote.unit, rate, 4)}</td>
      <td>${moneyCell(f.quote.total, rate, 2)}</td>
    </tr>`).join("");
  return `
    <div class="cmp-wrap offers-wrap" role="region" aria-labelledby="offers-cap" tabindex="0">
      <table class="cmp offers">
        <caption id="offers-cap" class="sr-only">Authorised distributor offers for ${esc(o.pn)}, priced at the order quantity</caption>
        <thead><tr><th scope="col">Distributor</th><th scope="col">Stock</th><th scope="col">MOQ</th><th scope="col">Packaging</th><th scope="col">Lead time</th><th scope="col">Order qty</th><th scope="col">Unit price</th><th scope="col">Total</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

function renderOriginal(o, required, {demand, original}, rate, live){
  const title = o.fromPart
    ? `<div><div class="pn">${esc(o.pn)}</div><div class="maker">${esc(o.live ? [o.mfr, o.description].filter(Boolean).join(" · ") : `${o.mfr} ceramic capacitor`)}</div></div>`
    : `<div><div class="pn">Spec from your description</div><div class="maker">No part number, so matching on these specs</div></div>`;
  const field = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  $("orig").innerHTML = `
    <div class="label-top">${title}<div class="barcode" aria-hidden="true"></div></div>
    <dl class="fields">
      ${field("Capacitance", fmtCap(o.cap))}${field("Voltage", fmtVolt(o.v))}
      ${field("Case", o.pkg || "Not specified")}${field("Dielectric", o.diel || "Not specified")}
      ${field("Tolerance", fmtTol(o.tol))}${field("Grade", GRADES[o.grade].label)}
      ${required !== o.grade ? field("Grade required now", GRADES[required].label) : ""}
      ${demand.qty ? field("Quantity needed", fmtStock(demand.qty)) : ""}
      ${demand.needBy ? field("Needed by", fmtWeek(demand.needBy, demand.today)) : ""}
      ${o.live ? field("Lifecycle", o.life || "Not listed") : ""}
      ${o.fromPart ? field(o.live ? "Unit price, best offer" : "Unit price (simulated)", money(o.usd, rate, 4)) : ""}
      ${o.fromPart && demand.qty && o.usd != null ? field(`Cost for ${fmtStock(demand.qty)}`, money(o.usd * demand.qty, rate, 0)) : ""}
    </dl>
    ${o.live ? `
      <p class="shortage">${o.stock ? `${fmtStock(o.stock)} in stock` : o.stock === 0 ? "No stock" : "Stock not listed"} at ${plural(o.offers.length, "authorised offer")}${o.lead != null ? `, shortest factory lead time ${o.lead} wk` : ""}.${waitText(original, demand)}</p>
      <p class="src">Live data: ${esc(sourceLabel(o))}${o.datasheet ? ` · <a href="${esc(o.datasheet)}" target="_blank" rel="noopener noreferrer">Datasheet<span class="sr-only"> (opens in a new tab)</span></a>` : ""}</p>
      ${renderOffers(o, rate)}
      <p class="hint">Prices use the break at the order quantity: what you need, at least the MOQ, rounded up to the order multiple. Offers are sorted by total cost.</p>
      ${liveLinks(o.pn)}`
    : o.fromPart ? `<p class="shortage">Simulated: ${o.stock ? fmtStock(o.stock) + " in stock" : "no stock"} at distribution, ${o.lead}-week factory lead time.${waitText(original, demand)}</p>${liveLinks(o.pn)}` : ""}
    ${live?.notices.length ? `<p class="notice">${live.notices.map(esc).join(" ")}</p>` : ""}`;
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
  if (part.stock == null && part.lead == null) return "not listed: no stock or lead time given";
  if (part.lead == null && !(qty == null ? part.stock > 0 : part.stock >= qty))
    return part.stock ? `stock covers ${qty == null ? fmtStock(part.stock) : Math.floor(part.stock / qty * 100) + "%"}, no lead time listed for the rest` : "no stock and no lead time listed";
  if (qty == null) return part.stock > 0 ? `from stock (${fmtStock(part.stock)})` : `${part.lead} wk from the factory`;
  if (part.stock >= qty) return `from stock, covers all ${fmtStock(qty)}`;
  if (part.stock > 0) return `stock covers ${Math.floor(part.stock / qty * 100)}% now, the rest in ${part.lead} wk`;
  return `no stock, ${part.lead} wk from the factory`;
}

function renderPlan(r, demand){
  const {approval, usableDate, onTime, lateWeeks} = r.plan;
  const chip = onTime == null ? "" : onTime
    ? `<span class="verdict v-ok">On time</span>`
    : `<span class="verdict v-warn">${lateWeeks} wk late</span>`;
  return `
    <div class="plan">
      <p class="plan-head"><span>Usable in production <b>${dateText(usableDate, demand.today)}</b></span>${chip}</p>
      <p class="plan-sub">Supply ${esc(supplyText(r.part, demand))}. Approval about ${approval.weeks} wk, run in parallel.</p>
      <details class="path">
        <summary>Approval path: ${approval.steps.length} step${approval.steps.length > 1 ? "s" : ""}, about ${approval.weeks} wk</summary>
        <ol class="steps">${approval.steps.map(s => `<li>${esc(s.text)} <span class="wk">${s.weeks} wk</span></li>`).join("")}</ol>
      </details>
    </div>`;
}

// Side-by-side comparison of the original against the top candidates.
function renderCompare(o, ranking, rate){
  const priceLabel = o.live ? "Unit price, best offer" : "Unit price (simulated)";
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
    plain("Lead time", o.fromPart ? weeksText(o.lead) : "—", cols.map(r => `<td>${weeksText(r.part.lead)}</td>`)),
    plain("Stock", o.fromPart ? fmtStock(o.stock) : "—", cols.map(r => `<td>${fmtStock(r.part.stock)}</td>`)),
    plain("Usable in production", o.fromPart && ranking.original ? esc(dateText(ranking.original.date, demand.today)) : "—", cols.map(r =>
      `<td>${esc(dateText(r.plan.usableDate, demand.today))}${r.plan.onTime == null ? "" : `<span class="cell-note">${r.plan.onTime ? "On time" : `${r.plan.lateWeeks} wk late`}</span>`}</td>`)),
    plain(priceLabel, o.fromPart ? moneyCell(o.usd, rate, 4) : "—", cols.map(r =>
      `<td>${moneyCell(r.cost.unit, rate, 4)}${r.cost.deltaPct == null ? "" : `<span class="cell-note">${pct(r.cost.deltaPct)} vs original</span>`}</td>`)),
    ...(demand.qty ? [plain(`Cost for ${fmtStock(demand.qty)}`, o.fromPart ? moneyCell(o.usd == null ? null : o.usd * demand.qty, rate, 0) : "—", cols.map(r =>
      `<td>${moneyCell(r.cost.total, rate, 0)}${r.cost.deltaTotal == null ? "" : `<span class="cell-note">${moneyCell(r.cost.deltaTotal, rate, 0, true).replace('<span class="mxn">', " · ").replace("</span>", "")} vs original</span>`}</td>`))] : [])
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
    <p class="hint cmp-note">${o.live
      ? `Specs, stock, lead times and prices from ${esc(sourceLabel(o))}. “Not listed” means the source doesn’t give it. Always confirm against the datasheet.`
      : "Specs come from the demo catalog and aren’t all verified against datasheets yet. Stock, lead times and prices are simulated."}</p>`;
}

function emptyMessage({mode, required, ranking, live}){
  if (live && !ranking.fits.length && !ranking.ruledOut.length){
    return `${live.source} lists no other part with the same capacitance to check. Try the live links above, or describe the part to search the demo catalog.`;
  }
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
  const {fits, ruledOut, dropIns, minor, major, equivalentOnly, demand, onTime} = ranking;
  $("cand-h").textContent = fits.length
    ? (mode === "better" ? "Better than the original, most upgrades first" : "Candidates, best first")
    : (mode === "better" ? "No upgrade found" : "No candidate fits every rule");

  const tally = [];
  if (onTime != null)  tally.push(`<li class="v-neutral">${onTime} usable by ${fmtWeek(demand.needBy, demand.today)}</li>`);
  if (dropIns)         tally.push(`<li class="v-ok">${dropIns} drop-in</li>`);
  if (minor)           tally.push(`<li class="v-warn">${minor} minor change</li>`);
  if (major)           tally.push(`<li class="v-bad">${major} major change</li>`);
  if (equivalentOnly)  tally.push(`<li class="v-neutral">${equivalentOnly} equivalent only</li>`);
  if (ruledOut.length) tally.push(`<li class="v-neutral">${ruledOut.length} ruled out</li>`);
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
    ? `${lateNote}${legend}${renderCompare(o, ranking, rate)}<h3 class="cmp-h">All candidates</h3><ol class="tape" aria-label="${mode === "better" ? "Upgrades ranked by number of improvements" : demand.needBy ? "Candidates ranked by on-time, fit, then usable date" : "Candidates ranked by fit, then usable date"}">${fits.map(r => `
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
          <p class="avail"><span>Stock <b>${fmtStock(r.part.stock)}</b></span><span>Lead time <b>${weeksText(r.part.lead)}</b></span><span>Unit price <b>${money(r.cost.unit, rate, 4)}</b>${r.cost.deltaPct == null ? "" : ` (${pct(r.cost.deltaPct)})`}</span>${
            demand.qty ? `<span>Cost for ${fmtStock(demand.qty)} <b>${money(r.cost.total, rate, 0)}</b>${r.cost.deltaTotal == null ? "" : ` (${signedMoney(r.cost.deltaTotal, rate, 0)})`}</span>` : ""}</p>
          ${r.part.live ? bestOffer(r.part) : ""}
          ${liveLinks(r.part.pn)}
        </li>`).join("")}</ol>`
    : `<p class="empty">${esc(emptyMessage({mode, required, ranking, live}))}</p>`;

  $("ruled-wrap").hidden = !ruledOut.length;
  $("ruled-wrap").open = !fits.length && mode !== "better" && required !== "medical";
  $("ruled-sum").textContent = `Ruled out (${ruledOut.length})`;
  $("ruled").innerHTML = ruledOut.map(r => `
    <li><span class="pn">${esc(r.part.pn)}</span> <span class="maker">${esc(r.part.mfr)}</span>
    <span class="why">${r.fails.map(esc).join("; ")}</span></li>`).join("");

  return `${fits.length} shown, ${ruledOut.length} ruled out.${onTime != null ? ` ${onTime} usable by the need date.` : ""}`;
}

// Where a live candidate's price comes from.
function bestOffer(p){
  const b = p.best;
  const bits = b
    ? [`Best offer: ${b.distributor || "Unknown"}`, b.packaging, `order ${fmtStock(b.quote.orderQty)}`]
    : ["No priced offer listed"];
  const ds = p.datasheet ? ` · <a href="${esc(p.datasheet)}" target="_blank" rel="noopener noreferrer">Datasheet<span class="sr-only"> (opens in a new tab)</span></a>` : "";
  return `<p class="src">${esc(bits.filter(Boolean).join(", "))} · ${esc(sourceLabel(p))}${ds}</p>`;
}

function setHash(o){
  const url = location.pathname + location.search + (o.fromPart ? "#" + o.pn : "");
  if (url !== location.pathname + location.search + location.hash) history.replaceState(null, "", url);
}

function showError(msg){
  $("status").textContent = "";
  $("q-err").textContent = msg;
  $("q-err").hidden = false;
  $("q").setAttribute("aria-invalid", "true");
}
function clearError(){
  $("q-err").hidden = true;
  $("q").removeAttribute("aria-invalid");
}

// Live lookup through the Worker. Returns {live} or {why} (why the page falls back to the demo catalog).
async function lookupLive(mpn, qty){
  let body = liveCache.get(mpn);
  if (!body){
    try {
      body = await fetchLive(API, mpn);
    } catch (e){
      return {why: e?.name === "AbortError" ? "the live-data service took too long to answer" : "the live-data service couldn’t be reached"};
    }
    // Keep answers that found the part, or where both sources answered that they don't list it.
    if (body.part || !Object.keys(body.errors || {}).length) liveCache.set(mpn, body);
  }
  const live = fromWorker(body, {qty});
  if (live.error === "notfound") return {why: "notfound"};
  if (live.error) return {why: `live data isn’t available right now (${live.error})`};
  if (live.spec.cap == null) return {why: `${live.source} lists ${mpn} without a capacitance, so there’s nothing to match it on`};
  return {live};
}

function setBusy(on, mpn){
  $("search-form").setAttribute("aria-busy", on ? "true" : "false");
  $("q-busy").hidden = !on;
  if (on){
    $("q-busy").textContent = `Looking up ${mpn} at authorised distributors…`;
    $("status").textContent = $("q-busy").textContent;
  }
}

async function search(query, {focusResults = true} = {}){
  const seq = ++searchSeq;
  const {mode, grade, qty, rate: rateIn, demand} = getOptions();

  let spec, live = null, fallback = null;
  const mpn = query.trim().toUpperCase();
  if (API && isMpnLike(query)){
    if (!liveCache.has(mpn)) setBusy(true, mpn);
    const got = await lookupLive(mpn, demand.qty);
    if (seq !== searchSeq) return;   // a newer search started meanwhile
    setBusy(false);
    if (got.live){ live = got.live; spec = live.spec; }
    else fallback = got.why;
  }
  if (!spec){
    const parsed = parseQuery(query);
    if (parsed.error){
      showError(fallback === "notfound"
        ? `${mpn} isn’t listed by Nexar or Mouser, and it isn’t in the demo catalog. Check the part number, or describe it, for example “0.1uF 50V X7R 0603”.`
        : fallback ? `${fallback[0].toUpperCase()}${fallback.slice(1)}. ${parsed.error}` : parsed.error);
      return;
    }
    spec = parsed.spec;
    if (fallback && spec.fromPart){
      fallback = fallback === "notfound" ? "Nexar and Mouser don’t list this part number" : fallback;
    }
  }
  clearError();

  const qtyBad = Number.isNaN(qty), rateBad = Number.isNaN(rateIn);
  const rate = rateBad ? null : rateIn;
  const problems = [
    qtyBad && "Enter the quantity as a number, like 250000 or 250k.",
    rateBad && "Enter the exchange rate as a number, like 18.50."
  ].filter(Boolean);
  $("qty-err").hidden = !problems.length;
  $("qty-err").textContent = problems.length ? `${problems.join(" ")} Results below ignore it.` : "";
  for (const [id, bad] of [["qty", qtyBad], ["rate", rateBad]]){
    if (bad) $(id).setAttribute("aria-invalid", "true"); else $(id).removeAttribute("aria-invalid");
  }

  const required = grade === "same" ? spec.grade : grade;
  const ranking = rank(spec, {mode, required, demand, ...(live ? {pool: live.pool} : {})});
  current = {query, spec};
  renderOriginal(spec, required, ranking, rate, live);
  if (fallback && spec.fromPart){
    $("orig").insertAdjacentHTML("beforeend",
      `<p class="notice">${esc(fallback[0].toUpperCase() + fallback.slice(1))}, so this shows the demo catalog with simulated stock and prices.</p>`);
  }
  const summary = renderCandidates(spec, ranking, {mode, required, rate, live});
  $("results").hidden = false;
  setHash(spec);
  $("status").textContent = (live ? `Live data from ${sourceLabel(live)}. ` : "") + summary;

  if (focusResults){
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("orig-h").scrollIntoView({behavior: reduce ? "auto" : "smooth", block:"start"});
    $("cand-h").focus({preventScroll:true});
  }
}

/* ---------- Wiring ---------- */
function setOptions({mode, grade, qty = "", weeks = null}){
  // The exchange rate is the viewer's own; examples leave it as it is.
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  $("grade").value = grade;
  $("qty").value = qty;
  $("need").value = weeks ? isoDate(addWeeks(today(), weeks)) : "";
}

function init(){
  $("parts").innerHTML = CATALOG.map(p =>
    `<option value="${p.pn}">${esc(`${p.mfr} ${fmtCap(p.cap)} ${p.v} V ${p.pkg} ${p.diel}${p.grade === "automotive" ? " AEC-Q200" : ""}`)}</option>`).join("");
  $("q-hint").textContent = API
    ? `Any manufacturer part number gets live specs, stock and prices from Nexar (Octopart), with Mouser as backup. Descriptions search the demo catalog: ${CATALOG.length} parts, ${CAP_VALUES.map(fmtCap).join(", ")}.`
    : `Demo catalog: ${CATALOG.length} parts, ${CAP_VALUES.map(fmtCap).join(", ")}.`;
  $("examples").innerHTML = EXAMPLES.map((ex, i) =>
    `<li><button type="button" data-i="${i}">${esc(ex.label)}</button></li>`).join("");

  $("search-form").addEventListener("submit", e => { e.preventDefault(); search($("q").value); });
  $("q").addEventListener("input", () => { if (!$("q-err").hidden) clearError(); });
  // Changing what you're looking for re-runs the last search in place.
  $("search-form").addEventListener("change", e => {
    if (e.target.id === "q" || !current) return;
    search(current.query, {focusResults:false});
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
    const pn = decodeURIComponent(location.hash.slice(1)).toUpperCase();
    if ((BY_PN.has(pn) || (API && isMpnLike(pn))) && (!current || current.spec.pn?.toUpperCase() !== pn)){
      $("q").value = pn;
      search(pn, {focusResults:false});
    }
  };
  addEventListener("hashchange", fromHash);
  fromHash();
}

init();
