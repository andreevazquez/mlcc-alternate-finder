// DOM rendering and wiring. All substitution logic lives in rules.js.
import {
  CATALOG, BY_PN, CAP_VALUES, DIEL_TEMP, GRADES, VERDICT_LABEL,
  fmtCap, fmtTol, fmtVolt, fmtStock, parseQuery, rank
} from "./rules.js";

const EXAMPLES = [
  {label:"0.1 µF, Murata, out of stock",        query:"GRM188R71H104KA93D",          mode:"equivalent", grade:"same"},
  {label:"10 µF from a BOM line, better than",  query:"CAP CER 10UF 10V X5R 0805",   mode:"better",     grade:"same"},
  {label:"Commercial design moving to automotive", query:"GRM188R71H104KA93D",       mode:"equivalent", grade:"automotive"},
  {label:"100 pF for a medical device",         query:"100pF 50V C0G 0603",          mode:"equivalent", grade:"medical"}
];

const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const $ = id => document.getElementById(id);
const MARK = {ok:"✓", warn:"!", bad:"✕", info:"i"};
const MARK_SR = {ok:"Pass", warn:"Review", bad:"Fail", info:"Note"};
let current = null;

function getOptions(){
  const mode = document.querySelector('input[name="mode"]:checked').value;
  const grade = $("grade").value;
  return {mode, grade};
}

function renderOriginal(o, required){
  const title = o.fromPart
    ? `<div><div class="pn">${esc(o.pn)}</div><div class="maker">${esc(o.mfr)} ceramic capacitor</div></div>`
    : `<div><div class="pn">Spec from your description</div><div class="maker">No part number, so matching on these specs</div></div>`;
  const field = (k, v) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`;
  $("orig").innerHTML = `
    <div class="label-top">${title}<div class="barcode" aria-hidden="true"></div></div>
    <dl class="fields">
      ${field("Capacitance", fmtCap(o.cap))}${field("Voltage", fmtVolt(o.v))}
      ${field("Case", o.pkg || "Not specified")}${field("Dielectric", o.diel || "Not specified")}
      ${field("Tolerance", fmtTol(o.tol))}${field("Grade", GRADES[o.grade].label)}
      ${required !== o.grade ? field("Grade required now", GRADES[required].label) : ""}
    </dl>
    ${o.fromPart ? `<p class="shortage">Simulated: ${o.stock ? fmtStock(o.stock) + " in stock" : "no stock"} at distribution, ${o.lead}-week factory lead time.</p>` : ""}`;
}

function emptyMessage({mode, required, ranking}){
  if (required === "medical"){
    return "No part in this demo catalog is released for medical use. A medical design needs the manufacturer’s medical-grade series, and life-support or implantable use usually needs the manufacturer’s written approval. AEC-Q200 doesn’t substitute for either.";
  }
  if (mode === "better"){
    return ranking.equivalentOnly
      ? `Nothing here beats the original without giving something up. ${ranking.equivalentOnly} part${ranking.equivalentOnly > 1 ? "s match" : " matches"} it exactly; switch to “Equivalent” to see ${ranking.equivalentOnly > 1 ? "them" : "it"}.`
      : "Nothing here beats the original without giving something up. Check the ruled-out list for near misses.";
  }
  return "A near miss below might still work with an engineering deviation. Open the ruled-out list to see what failed.";
}

function renderCandidates(ranking, {mode, required}){
  const {fits, ruledOut, dropIns, reviews, equivalentOnly} = ranking;
  $("cand-h").textContent = fits.length
    ? (mode === "better" ? "Better than the original, most upgrades first" : "Candidates, best first")
    : (mode === "better" ? "No upgrade found" : "No candidate fits every rule");

  const tally = [];
  if (dropIns)         tally.push(`<li class="v-ok">${dropIns} drop-in</li>`);
  if (reviews)         tally.push(`<li class="v-warn">${reviews} need review</li>`);
  if (equivalentOnly)  tally.push(`<li class="v-neutral">${equivalentOnly} equivalent only</li>`);
  if (ruledOut.length) tally.push(`<li class="v-bad">${ruledOut.length} ruled out</li>`);
  $("tally").innerHTML = tally.join("");

  $("cand-body").innerHTML = fits.length
    ? `<ol class="tape" aria-label="${mode === "better" ? "Upgrades ranked by number of improvements" : "Candidates ranked by fit, then lead time"}">${fits.map(r => `
        <li class="pocket">
          <div class="pocket-head">
            <h3><span class="pn">${esc(r.part.pn)}</span> <span class="maker">${esc(r.part.mfr)}</span></h3>
            <span class="verdict v-${r.verdict}">${VERDICT_LABEL[r.verdict]}</span>
          </div>
          ${r.upgrades.length ? `<p class="better">Better on: ${r.upgrades.map(esc).join(", ")}</p>` : ""}
          <ul class="checks">${r.checks.map(k => `
            <li><span class="mark m-${k.state}" aria-hidden="true">${MARK[k.state]}</span><span><span class="sr-only">${MARK_SR[k.state]}: </span>${esc(k.text)}</span></li>`).join("")}
          </ul>
          <p class="avail"><span>Stock <b>${fmtStock(r.part.stock)}</b></span><span>Lead time <b>${r.part.lead} wk</b></span><span>Operating temp <b>${DIEL_TEMP[r.part.diel]}</b></span></p>
        </li>`).join("")}</ol>`
    : `<p class="empty">${esc(emptyMessage({mode, required, ranking}))}</p>`;

  $("ruled-wrap").hidden = !ruledOut.length;
  $("ruled-wrap").open = !fits.length && mode !== "better" && required !== "medical";
  $("ruled-sum").textContent = `Ruled out (${ruledOut.length})`;
  $("ruled").innerHTML = ruledOut.map(r => `
    <li><span class="pn">${esc(r.part.pn)}</span> <span class="maker">${esc(r.part.mfr)}</span>
    <span class="why">${r.fails.map(esc).join("; ")}</span></li>`).join("");

  return `${fits.length} shown, ${ruledOut.length} ruled out.`;
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

function search(query, {focusResults = true} = {}){
  const {spec, error} = parseQuery(query);
  if (error){ showError(error); return; }
  clearError();

  const {mode, grade} = getOptions();
  const required = grade === "same" ? spec.grade : grade;
  const ranking = rank(spec, {mode, required});
  current = {query, spec};
  renderOriginal(spec, required);
  const summary = renderCandidates(ranking, {mode, required});
  $("results").hidden = false;
  setHash(spec);
  $("status").textContent = summary;

  if (focusResults){
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    $("orig-h").scrollIntoView({behavior: reduce ? "auto" : "smooth", block:"start"});
    $("cand-h").focus({preventScroll:true});
  }
}

/* ---------- Wiring ---------- */
function setOptions({mode, grade}){
  document.querySelector(`input[name="mode"][value="${mode}"]`).checked = true;
  $("grade").value = grade;
}

function init(){
  $("parts").innerHTML = CATALOG.map(p =>
    `<option value="${p.pn}">${esc(`${p.mfr} ${fmtCap(p.cap)} ${p.v} V ${p.pkg} ${p.diel}${p.grade === "automotive" ? " AEC-Q200" : ""}`)}</option>`).join("");
  $("q-hint").textContent = `Demo catalog: ${CATALOG.length} parts, ${CAP_VALUES.map(fmtCap).join(", ")}.`;
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
    if (BY_PN.has(pn) && (!current || current.spec.pn !== pn)){
      $("q").value = pn;
      search(pn, {focusResults:false});
    }
  };
  addEventListener("hashchange", fromHash);
  fromHash();
}

init();
