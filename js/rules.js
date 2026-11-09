// Pure substitution logic: catalog, parsing, rules, ranking and formatting.
// No DOM access, so it runs unchanged in the browser and under `node --test`.
import {decodeMpn} from "./mpn.js";

/* ---------- Data ---------- */
// cap: picofarads · tol: percent (Y5V stored as 80, its worst case)
// stock, lead (weeks) and usd (unit price at reel quantity) are simulated
// h (height, mm) and term (termination) are read from the part number where it encodes them (mpn.js)
const RAW = [
  {pn:"GRM188R71H104KA93D",  mfr:"Murata",      cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:0,       lead:26, usd:0.0045},
  {pn:"C1608X7R1H104K080AA", mfr:"TDK",         cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:120000,  lead:4, usd:0.0042},
  {pn:"CL10B104KB8NNNC",     mfr:"Samsung",     cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:480000,  lead:2, usd:0.0028},
  {pn:"CC0603KRX7R9BB104",   mfr:"Yageo",       cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:950000,  lead:1, usd:0.0022},
  {pn:"C0603C104K5RACTU",    mfr:"KEMET",       cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:36000,   lead:8, usd:0.0050},
  {pn:"06035C104KAT2A",      mfr:"KYOCERA AVX", cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:12000,   lead:14, usd:0.0060},
  {pn:"GCM188R71H104KA57D",  mfr:"Murata",      cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:true,  stock:8000,    lead:22, usd:0.0095},
  {pn:"GCJ188R71H104KA12D",  mfr:"Murata",      cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:true,  stock:0,       lead:16, usd:0.0120},
  {pn:"CGA3E2X7R1H104K080AA",mfr:"TDK",         cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:true,  stock:64000,   lead:6, usd:0.0088},
  {pn:"GRM188R72A104KA35D",  mfr:"Murata",      cap:100000,   v:100, pkg:"0603", diel:"X7R", tol:10, auto:false, stock:210000,  lead:3, usd:0.0070},
  {pn:"CL10F104ZB8NNNC",     mfr:"Samsung",     cap:100000,   v:50,  pkg:"0603", diel:"Y5V", tol:80, auto:false, stock:700000,  lead:1, usd:0.0015},
  {pn:"GRM155R71C104KA88D",  mfr:"Murata",      cap:100000,   v:16,  pkg:"0402", diel:"X7R", tol:10, auto:false, stock:1500000, lead:2, usd:0.0030},
  {pn:"CL21B104KBCNNNC",     mfr:"Samsung",     cap:100000,   v:50,  pkg:"0805", diel:"X7R", tol:10, auto:false, stock:300000,  lead:2, usd:0.0040},
  {pn:"C1608X7R1E104K080AA", mfr:"TDK",         cap:100000,   v:25,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:260000,  lead:3, usd:0.0035},
  {pn:"GRM21BR61A106KE19L",  mfr:"Murata",      cap:10000000, v:10,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:0,       lead:30, usd:0.0300},
  {pn:"C2012X5R1A106K125AB", mfr:"TDK",         cap:10000000, v:10,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:40000,   lead:9, usd:0.0320},
  {pn:"CL21A106KAYNNNE",     mfr:"Samsung",     cap:10000000, v:25,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:220000,  lead:3, usd:0.0280},
  {pn:"CC0805KKX5R6BB106",   mfr:"Yageo",       cap:10000000, v:10,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:380000,  lead:2, usd:0.0220},
  {pn:"GRM21BR61E106KA73L",  mfr:"Murata",      cap:10000000, v:25,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:18000,   lead:12, usd:0.0450},
  {pn:"CL21B106KOQNNNE",     mfr:"Samsung",     cap:10000000, v:16,  pkg:"0805", diel:"X7R", tol:10, auto:false, stock:90000,   lead:5, usd:0.0380},
  {pn:"GRM188R61A106KE69D",  mfr:"Murata",      cap:10000000, v:10,  pkg:"0603", diel:"X5R", tol:20, auto:false, stock:500000,  lead:2, usd:0.0250},
  {pn:"GRM155R61A105KE15D",  mfr:"Murata",      cap:1000000,  v:10,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:0,       lead:24, usd:0.0040},
  {pn:"C1005X5R1A105K050BB", mfr:"TDK",         cap:1000000,  v:10,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:410000,  lead:2, usd:0.0042},
  {pn:"CL05A105KA5NQNC",     mfr:"Samsung",     cap:1000000,  v:25,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:1200000, lead:1, usd:0.0030},
  {pn:"CC0402KRX5R6BB105",   mfr:"Yageo",       cap:1000000,  v:10,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:85000,   lead:6, usd:0.0028},
  {pn:"GRM1885C1H101JA01D",  mfr:"Murata",      cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:0,       lead:20, usd:0.0030},
  {pn:"C1608C0G1H101J080AA", mfr:"TDK",         cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:150000,  lead:3, usd:0.0032},
  {pn:"C0603C101J5GACTU",    mfr:"KEMET",       cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:44000,   lead:7, usd:0.0045},
  {pn:"CC0603JRNPO9BN101",   mfr:"Yageo",       cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:620000,  lead:1, usd:0.0020},
  {pn:"GCM1885C1H101JA16D",  mfr:"Murata",      cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:true,  stock:26000,   lead:10, usd:0.0070},
  {pn:"CL10B101KB8NNNC",     mfr:"Samsung",     cap:100,      v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:340000,  lead:2, usd:0.0018}
];
export const CATALOG = Object.freeze(RAW.map(({auto, ...p}) => {
  const dec = decodeMpn(p.pn) || {};
  return Object.freeze({...p, h: dec.h ?? null, term: dec.term ?? null, grade: auto ? "automotive" : "commercial"});
}));
export const BY_PN = new Map(CATALOG.map(p => [p.pn, p]));
export const CAP_VALUES = [...new Set(CATALOG.map(p => p.cap))].sort((a, b) => a - b);

export const DIEL_RANK = {Y5V:0, X5R:1, X7R:2, C0G:3};
export const DIEL_TEMP = {Y5V:"−30 to 85 °C", X5R:"−55 to 85 °C", X7R:"−55 to 125 °C", C0G:"−55 to 125 °C"};
// Class II dielectrics lose capacitance under DC voltage; C0G (class I) doesn't.
export const CLASS_II = new Set(["X5R", "X7R", "Y5V"]);
export const TERM_LABEL = {flex:"Flexible (soft)", standard:"Standard"};

// Application grades are not a ladder: AEC-Q200 can stand in for commercial,
// but nothing except a manufacturer's medical-grade series qualifies for medical use.
export const GRADES = {
  commercial:{label:"Commercial",            short:"commercial"},
  automotive:{label:"Automotive (AEC-Q200)", short:"AEC-Q200"},
  medical:   {label:"Medical",               short:"medical grade"}
};
const SATISFIES = {commercial:["commercial", "automotive", "medical"], automotive:["automotive"], medical:["medical"]};
export const meetsGrade = (partGrade, required) => SATISFIES[required].includes(partGrade);

export const VERDICT_LABEL = {ok:"Drop-in", warn:"Fits, needs review", bad:"Not compatible"};
const VERDICT_ORDER = {ok:0, warn:1, bad:2};

/* ---------- Formatting ---------- */
const trimNum = n => String(Number(n.toPrecision(6)));
export function fmtCap(pf){
  if (pf == null) return "Not specified";
  if (pf >= 100000) return trimNum(pf / 1e6) + " µF";
  if (pf >= 1000)   return trimNum(pf / 1e3) + " nF";
  return trimNum(pf) + " pF";
}
export const fmtTol   = t => t == null ? "Not specified" : t === 80 ? "+80/−20%" : "±" + t + "%";
export const fmtVolt  = v => v == null ? "Not specified" : v + " V";
export const fmtHeight = h => h == null ? "Not listed" : `${h} mm`;
export const fmtTerm  = t => TERM_LABEL[t] || "Not listed";
export const fmtStock = n => n == null ? "Unknown" : n === 0 ? "None" : n >= 1e6 ? trimNum(n / 1e6) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);

/* ---------- Live sources ---------- */
// Search pages that show live price, stock and MOQ for a part number. The page only links to
// them; it never copies their data.
// Links that come from a distributor API are only shown if they are plain http(s) URLs,
// so a "javascript:" or "data:" value in a listing can never run in this page.
export function safeUrl(u){
  if (typeof u !== "string") return null;
  try {
    const url = new URL(u.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch { return null; }
}

export function liveSources(pn){
  const q = encodeURIComponent(pn);
  return [
    {name:"TrustedParts", url:`https://www.trustedparts.com/en/search/${q}`},
    {name:"Octopart",     url:`https://octopart.com/search?q=${q}`},
    {name:"Findchips",    url:`https://www.findchips.com/search/${q}`},
    {name:"Digi-Key",     url:`https://www.digikey.com/en/products/result?keywords=${q}`},
    {name:"Mouser",       url:`https://www.mouser.com/c/?q=${q}`}
  ];
}

/* ---------- Parsing ---------- */
const looksLikePartNumber = s => /^[A-Z0-9-]{8,}$/.test(s) && /\d/.test(s) && /[A-Z]/.test(s);

// Returns {spec} on success or {error} with a message that says how to fix it.
export function parseQuery(raw){
  const q = raw.trim();
  if (!q) return {error:"Enter a part number or a description like “0.1uF 50V X7R 0603”."};

  const compact = q.toUpperCase().replace(/\s+/g, "");
  if (BY_PN.has(compact)) return {spec:{...BY_PN.get(compact), fromPart:true}};
  if (!/\s/.test(q) && looksLikePartNumber(compact)){
    const matches = CATALOG.filter(p => p.pn.startsWith(compact));
    if (matches.length === 1) return {spec:{...matches[0], fromPart:true}};
    if (matches.length > 1) return {error:`“${q}” matches ${matches.length} parts. Pick one from the suggestions.`};
    return {error:`${compact} isn’t in this demo catalog. Describe it instead, for example “0.1uF 50V X7R 0603”.`};
  }

  const t = q.toLowerCase().replace(/µ/g, "u");
  const spec = {fromPart:false, pn:null, mfr:null, cap:null, v:null, pkg:null, diel:null, tol:null, grade:"commercial"};
  const cap = t.match(/(\d+(?:\.\d+)?)\s*(p|n|u)f?\b/);
  if (cap) spec.cap = Math.round(parseFloat(cap[1]) * {p:1, n:1e3, u:1e6}[cap[2]]);
  const volt = t.match(/(\d+(?:\.\d+)?)\s*v(?:dc)?\b/);
  if (volt) spec.v = parseFloat(volt[1]);
  const pkg = t.match(/\b(0201|0402|0603|0805|1206|1210)\b/);
  if (pkg) spec.pkg = pkg[1];
  const diel = t.match(/\b(c0g|cog|np0|npo|x7r|x5r|y5v)\b/);
  if (diel){ const d = diel[1].toUpperCase(); spec.diel = DIEL_RANK[d] != null ? d : "C0G"; }
  const tol = t.match(/(\d+)\s*%/);
  if (tol) spec.tol = parseInt(tol[1], 10);
  if (/medical/.test(t)) spec.grade = "medical";
  else if (/aec|automotive|\bauto\b/.test(t)) spec.grade = "automotive";

  if (spec.cap == null) return {error:"Add a capacitance so there’s something to match, for example “10uF” or “100nF”."};
  if (!CAP_VALUES.includes(spec.cap)){
    return {error:`${fmtCap(spec.cap)} isn’t in this demo catalog. It covers ${CAP_VALUES.map(fmtCap).join(", ")}.`};
  }
  return {spec};
}

// Offline fallback: when live data can't be reached, a part number in a format mpn.js reads still
// gives a spec to match against the demo catalog. Stock, lead time and price stay unknown.
// Returns null when the format isn't readable or a spec the rules need is missing.
export function specFromPartNumber(raw){
  const pn = String(raw ?? "").trim().toUpperCase();
  const d = decodeMpn(pn);
  if (!d || d.v == null || d.pkg == null || DIEL_RANK[d.diel] == null) return null;
  return {pn, mfr: d.mfr, cap: d.cap, v: d.v, pkg: d.pkg, diel: d.diel, tol: d.tol, h: d.h, term: d.term,
    grade: d.auto ? "automotive" : "commercial", stock: null, lead: null, usd: null, fromPart: true, offline: true};
}

/* ---------- Rules ---------- */
// Each check is one row of the datasheet comparison:
//   {key, label, orig, value, state, level, text}
// state (ok|warn|bad|info) decides the fit verdict; "info" never changes it.
// level is what the comparison colors show:
//   same     – identical (green)
//   minor    – differs, but doesn't affect the design (yellow)
//   unknown  – not listed for one of the parts, so it can't be compared (grey)
//   critical – needs a product engineer, or rules the part out (red)
// upgrades: the specs where the candidate is strictly better than what's required.
// flags: engineering-review reminders ({key, title, text}). They never rule a part out or change
// the verdict; they name what the engineer should look at, and fewer flags rank first among equals.
const LEVEL_OF = {ok:"same", info:"minor", warn:"critical", bad:"critical"};
const TEMP_RANGE = {Y5V:[-30, 85], X5R:[-55, 85], X7R:[-55, 125], C0G:[-55, 125]};
export const CHECK_ROWS = ["cap", "pkg", "h", "v", "diel", "temp", "tol", "grade", "term", "life", "mfr"];

export function evaluate(o, c, required){
  const checks = [], upgrades = [];
  const auto = required === "automotive";
  let row = {};
  const at = (key, label, orig, value) => { row = {key, label, orig, value}; };
  const add = (state, text, level = LEVEL_OF[state]) => checks.push({...row, state, level, text});
  const spec = v => v == null ? "Not specified" : v;

  at("cap", "Capacitance", fmtCap(o.cap), fmtCap(c.cap));
  add(c.cap === o.cap ? "ok" : "bad",
      c.cap === o.cap ? `Capacitance ${fmtCap(c.cap)}` : `Capacitance ${fmtCap(c.cap)}, needs ${fmtCap(o.cap)}`);

  at("pkg", "Case size", spec(o.pkg), c.pkg);
  if (o.pkg == null)        add("warn", `Case ${c.pkg}: you didn’t give one, confirm the footprint`);
  else if (c.pkg === o.pkg) add("ok",   `Case ${c.pkg}, same footprint`);
  else                      add("bad",  `Case ${c.pkg} won’t fit the ${o.pkg} footprint`);

  at("h", "Height (max)", fmtHeight(o.h), fmtHeight(c.h));
  if (o.h == null || c.h == null) add("info", `Height ${c.h == null ? "not listed" : `${c.h} mm`}${o.h == null ? ", original not listed" : ""}: confirm against the datasheet`, "unknown");
  else if (c.h === o.h)           add("ok",   `Height ${c.h} mm, same as the original`);
  else                            add("info", `Height ${c.h} mm vs ${o.h} mm, same case size`);

  at("v", "Rated voltage", fmtVolt(o.v), fmtVolt(c.v));
  if (o.v == null)      add("warn", `Rated ${c.v} V: you didn’t give a voltage, confirm it covers the circuit`);
  else if (c.v === o.v) add("ok",   `Rated ${c.v} V`);
  else if (c.v > o.v){  add("warn", `Rated ${c.v} V, up from ${o.v} V: a different design, confirm height and DC-bias curve`); upgrades.push(`${c.v} V vs ${o.v} V`); }
  else                  add("bad",  `Rated ${c.v} V, below the ${o.v} V required`);

  at("diel", "Dielectric", spec(o.diel), c.diel);
  if (o.diel == null)                             add("warn", `Dielectric ${c.diel}: you didn’t give one, confirm with engineering`);
  else if (c.diel === o.diel)                     add("ok",   `Dielectric ${c.diel}`);
  else if (DIEL_RANK[c.diel] > DIEL_RANK[o.diel]){ add("warn", `${c.diel} instead of ${o.diel}: more stable, confirm with engineering`); upgrades.push(`${c.diel} vs ${o.diel}`); }
  else                                            add("bad",  `${c.diel} is a downgrade from ${o.diel}: drifts more with temperature and voltage`);

  at("temp", "Operating temp", o.diel ? DIEL_TEMP[o.diel] : "Not specified", DIEL_TEMP[c.diel]);
  const [cLo, cHi] = TEMP_RANGE[c.diel];
  if (o.diel == null) add("info", `Operating temp ${DIEL_TEMP[c.diel]}`);
  else {
    const [oLo, oHi] = TEMP_RANGE[o.diel];
    if (cLo === oLo && cHi === oHi)  add("ok",  `Operating temp ${DIEL_TEMP[c.diel]}`);
    else if (cLo <= oLo && cHi >= oHi) add("ok", `Operating temp ${DIEL_TEMP[c.diel]}, wider than needed`, "minor");
    else                             add("bad", `Operating temp ${DIEL_TEMP[c.diel]}, narrower than ${DIEL_TEMP[o.diel]}`);
  }

  at("tol", "Tolerance", fmtTol(o.tol), fmtTol(c.tol));
  if (c.tol == null)        add("warn", "Tolerance not listed: check the datasheet");
  else if (o.tol == null)   add("info", `Tolerance ${fmtTol(c.tol)}`);
  else if (c.tol === o.tol) add("ok",   `Tolerance ${fmtTol(c.tol)}`);
  else if (c.tol < o.tol){  add("ok",   `Tolerance ${fmtTol(c.tol)}, tighter than needed`, "minor"); upgrades.push(`${fmtTol(c.tol)} vs ${fmtTol(o.tol)}`); }
  else                      add("bad",  `Tolerance ${fmtTol(c.tol)}, looser than ${fmtTol(o.tol)}`);

  at("grade", "Grade", GRADES[required].label + (required === o.grade ? "" : " (required)"), GRADES[c.grade].label);
  if (!meetsGrade(c.grade, required)){
    add("bad", required === "medical"
      ? `${GRADES[c.grade].label}, not released for medical use`
      : `${GRADES[c.grade].label} grade; ${GRADES[required].label} required`);
  } else if (c.grade === required){
    add("ok", required === "commercial" ? "Commercial grade" : `${GRADES[c.grade].label}, as required`);
  } else {
    add("ok", `${GRADES[c.grade].label}, above the ${GRADES[required].short} requirement`, "minor");
    upgrades.push(GRADES[c.grade].short);
  }

  // Termination: flexible (soft) termination absorbs board flex that cracks a standard MLCC.
  // Automotive boards rely on it near connectors, edges and screw holes, so losing it needs review.
  at("term", "Termination", fmtTerm(o.term), fmtTerm(c.term));
  if (c.term === "flex" && o.term !== "flex"){
    add("ok", "Flexible termination: more robust against board flex", "minor");
    if (o.term === "standard") upgrades.push("flexible termination");
  }
  else if (o.term === "flex" && c.term === "standard")
    add(auto ? "warn" : "info", `Standard termination replacing flexible${auto ? ": board-flex cracking risk, needs engineering review" : ""}`);
  else if (o.term === "flex" && c.term == null)
    add(auto ? "warn" : "info", `Termination not listed; the original is flexible${auto ? ": confirm before approving" : ""}`, auto ? undefined : "unknown");
  else if (o.term != null && c.term === o.term) add("ok", `${fmtTerm(c.term)} termination, same as the original`);
  else add("info", `Termination ${c.term == null ? "not listed" : fmtTerm(c.term).toLowerCase()}: confirm against the datasheet`, "unknown");

  // Lifecycle: no catalog part is verified yet, so this stays a note until DATA_CHECK.md fills it in.
  at("life", "Lifecycle", o.fromPart ? (o.life || "Not verified") : "—", c.life || "Not verified");
  if (c.life === "EOL")       add("bad",  "End of life: don’t approve it as an alternate");
  else if (c.life === "NRND") add("warn", "Not recommended for new designs: check last-time-buy dates");
  else if (c.life === "Active") add("ok", "Lifecycle: active");
  else                        add("info", "Lifecycle not verified: check active, NRND or EOL");

  at("mfr", "Manufacturer", o.mfr || "Not specified", c.mfr);
  if (!o.mfr)              add("info", `Confirm ${c.mfr} is on your AML`);
  else if (c.mfr === o.mfr) add("info", `Same manufacturer, already on your AML`, "same");
  else                     add("info", `New manufacturer: needs an AML entry`);

  const verdict = checks.some(k => k.state === "bad") ? "bad" : checks.some(k => k.state === "warn") ? "warn" : "ok";
  return {part:c, checks, verdict, upgrades, flags:reviewFlags(o, c, required), fails:checks.filter(k => k.state === "bad").map(k => k.text)};
}

// Engineering-review flags: what an engineer should look at before approving, with no calculation.
//   DC bias      – a class II candidate (X5R, X7R, Y5V) that isn't the same design as the original
//                  (other manufacturer, rated voltage, dielectric or height). Y5V is always flagged.
//   Height       – both heights known and different, or unknown when the rated voltage changes
//                  (a higher-voltage part in the same case is often thicker).
//   Termination  – automotive only: the candidate's termination differs from the original's or isn't
//                  listed. Flexible (soft) termination is what keeps a part from cracking under board flex.
export function reviewFlags(o, c, required){
  const flags = [];
  if (CLASS_II.has(c.diel)){
    const sameDesign = o.mfr === c.mfr && o.v === c.v && o.diel === c.diel && o.h != null && o.h === c.h;
    if (c.diel === "Y5V") flags.push({key:"dcbias", title:"DC bias",
      text:"Y5V can lose most of its capacitance at rated voltage and over temperature. Check the DC-bias curve at the circuit’s working voltage."});
    else if (!sameDesign) flags.push({key:"dcbias", title:"DC bias",
      text:`${c.diel} loses capacitance under DC voltage, and the curve differs by manufacturer, rated voltage and height. Compare the DC-bias curves at the circuit’s working voltage.`});
  }
  if (o.h != null && c.h != null && o.h !== c.h){
    flags.push({key:"height", title:"Height",
      text:`${c.h} mm vs ${o.h} mm in the same ${c.pkg} case. Check stencil and placement, and clearance under shields, connectors or a housing.`});
  } else if ((o.h == null || c.h == null) && o.v != null && c.v !== o.v){
    flags.push({key:"height", title:"Height",
      text:`Rated voltage changes (${o.v} V to ${c.v} V) and the height isn’t in the part number. The same case comes in several thicknesses; confirm against the datasheet.`});
  }
  if (required === "automotive" && (c.term == null || c.term !== o.term)){
    flags.push({key:"term", title:"Termination",
      text: c.term === "flex"
        ? "Flexible termination where the original has " + (o.term ? "standard" : "an unlisted termination") + ". Usually an improvement; confirm solder joint and AEC-Q200 data."
        : `Termination ${c.term ? "is standard" : "isn’t listed"}${o.term === "flex" ? " and the original is flexible" : ""}. Confirm whether this location needs flexible (soft) termination: board flex near connectors, edges and screw holes cracks standard MLCCs.`});
  }
  return flags;
}

/* ---------- Planning ---------- */
// Typical approval durations, in weeks. They vary by company and customer;
// the page states them as assumptions.
export const APPROVAL_STEPS = {
  aml:    {weeks:1, text:"Add the part number to the AML and the ERP item master"},
  mfr:    {weeks:3, text:"Samples and build validation for a new manufacturer"},
  mfrChk: {weeks:3, text:"Samples and build validation, unless the manufacturer is already on your AML"},
  eng:    {weeks:2, text:"Engineering review of the flagged items"},
  ppap:   {weeks:6, text:"PPAP and customer approval: automotive customers must approve a change of component"}
};

// The steps a candidate needs before it can go into production, in order.
export function approvalPath(o, r, required){
  const keys = [];
  if (r.verdict === "warn") keys.push("eng");
  if (!o.mfr) keys.push("mfrChk");
  else if (r.part.mfr !== o.mfr) keys.push("mfr");
  if (required === "automotive") keys.push("ppap");
  keys.push("aml");
  const steps = keys.map(k => ({key:k, ...APPROVAL_STEPS[k]}));
  return {steps, weeks:steps.reduce((n, s) => n + s.weeks, 0)};
}

// How big the change is, from the steps it needs.
export const CHANGE_TYPES = {
  dropin:{label:"Drop-in",      order:0, level:"same"},
  minor: {label:"Minor change", order:1, level:"minor"},
  major: {label:"Major change", order:2, level:"critical"}
};
export function changeType({steps}){
  const keys = steps.map(s => s.key);
  if (keys.includes("eng"))  return {type:"major", ...CHANGE_TYPES.major, reason:"Needs a product engineer to review the flagged specs"};
  if (keys.includes("ppap")) return {type:"major", ...CHANGE_TYPES.major, reason:"Automotive: needs PPAP and customer approval"};
  if (keys.includes("mfr"))  return {type:"minor", ...CHANGE_TYPES.minor, reason:"New manufacturer: samples and AML entry, no design change"};
  if (keys.includes("mfrChk")) return {type:"minor", ...CHANGE_TYPES.minor, reason:"Samples and AML entry unless the manufacturer is already approved"};
  return {type:"dropin", ...CHANGE_TYPES.dropin, reason:"Same manufacturer and fit: AML entry only"};
}

// Unit price and, with a quantity, total cost and the difference against the original (USD).
export function costPlan(o, c, qty){
  const unit = c.usd ?? null;
  const total = qty == null || unit == null ? null : unit * qty;
  const base = unit == null ? null : o.usd ?? null;
  const deltaUnit = base == null ? null : unit - base;
  return {unit, total, deltaUnit, deltaTotal: deltaUnit == null || qty == null ? null : deltaUnit * qty,
          deltaPct: base ? deltaUnit / base : null};
}

// "250000", "250,000", "250k", "1.2M" -> pieces. Empty -> null. Anything else -> NaN.
export function parseQty(raw){
  const s = String(raw ?? "").trim().toLowerCase().replace(/[,\s_]/g, "");
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)(k|m)?(pcs?)?$/);
  if (!m) return NaN;
  const n = Math.round(parseFloat(m[1]) * (m[2] === "k" ? 1e3 : m[2] === "m" ? 1e6 : 1));
  return n > 0 ? n : NaN;
}

const DAY = 864e5;
export const addWeeks = (d, w) => { const x = new Date(d); x.setDate(x.getDate() + w * 7); return x; };
export function isoWeek(d){
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  x.setUTCDate(x.getUTCDate() + 4 - (x.getUTCDay() || 7));
  return Math.ceil(((x - Date.UTC(x.getUTCFullYear(), 0, 1)) / DAY + 1) / 7);
}
// Day, month name, year ("9 Nov 2026"): reads the same in every country, unlike 11/09/2026.
// Built by hand rather than with toLocaleDateString so it never varies by browser or locale.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const fmtDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
export const fmtWeek = d => `wk ${isoWeek(d)} · ${fmtDate(d)}`;

// Monday of ISO week w in year y.
export function isoWeekMonday(y, w){
  const jan4 = new Date(y, 0, 4);
  const monday = new Date(y, 0, 4 - ((jan4.getDay() + 6) % 7));
  monday.setDate(monday.getDate() + (w - 1) * 7);
  return monday;
}
const weeksInYear = y => isoWeek(new Date(y, 11, 28));

// The "Needed by" field. Accepts "9 Dec 2026", "Dec 9, 2026", "9-dec", "2026-12-09" and planning
// weeks ("wk 50", "W50 2026"). A missing year means the next such date from today. All-number
// dates like 12/09/2026 are refused: they read as 9 Dec in the US and 12 Sep elsewhere.
// Returns {date} (null when empty) or {error}.
export function parseNeedDate(raw, today = new Date()){
  const s = String(raw ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  if (!s) return {date:null};
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const valid = (y, m, d) => {
    const x = new Date(y, m, d);
    return x.getFullYear() === y && x.getMonth() === m && x.getDate() === d ? x : null;
  };
  const withYear = (y, make) => {
    if (y != null) return make(y);
    const x = make(t0.getFullYear());
    return x && x < t0 ? make(t0.getFullYear() + 1) : x;
  };
  const bad = {error:"Write the date as 9 Dec 2026, 2026-12-09 or wk 50."};

  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return (d => d ? {date:d} : bad)(valid(+m[1], +m[2] - 1, +m[3]));

  m = s.match(/^(?:wk|w|week|cw|kw)\.? ?(\d{1,2})(?:[ ,/-]+(\d{4}))?$/);
  if (m){
    const w = +m[1];
    const make = y => w >= 1 && w <= weeksInYear(y) ? isoWeekMonday(y, w) : null;
    // A week without a year is this week or later: the Monday may already be past.
    const d = m[2] ? make(+m[2]) : (() => {
      const x = make(t0.getFullYear());
      return x && addWeeks(x, 1) > t0 ? x : make(t0.getFullYear() + 1);
    })();
    return d ? {date:d} : {error:`There’s no week ${w} in that year. Use wk 1 to wk ${weeksInYear(m[2] ? +m[2] : t0.getFullYear())}.`};
  }

  if (/^\d{1,4}[/.-]\d{1,2}([/.-]\d{2,4})?$/.test(s))
    return {error:"Dates in numbers alone are ambiguous (12/09 is 9 Dec in the US, 12 Sep elsewhere). Write 9 Dec 2026 or 2026-12-09."};

  const month = w => { const i = MONTHS.findIndex(n => w.startsWith(n.toLowerCase())); return i >= 0 && w.length <= 9 ? i : null; };
  m = s.match(/^(\d{1,2})(?:st|nd|rd|th)?[ .,/-]*([a-z]{3,9})\.?(?:[ .,/-]+(\d{4}))?$/)
    || (x => x && [x[0], x[2], x[1], x[3]])(s.match(/^([a-z]{3,9})\.?[ .-]*(\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?$/));
  if (m){
    const mo = month(m[2]);
    if (mo == null) return bad;
    const d = withYear(m[3] ? +m[3] : null, y => valid(y, mo, +m[1]));
    return d ? {date:d} : {error:`${MONTHS[mo]} doesn’t have a day ${+m[1]}.`};
  }
  return bad;
}
export const fmtWeeks = w => w === 0 ? "now" : `${w} wk`;
const daysBetween = (a, b) => Math.round((b - a) / DAY);

// Supply: stock covers the need (or, with no quantity, any stock) -> now; otherwise the factory lead time.
// Usable: the later of supply and approval, assuming you order while approval runs.
// Live parts can lack stock or a lead time: then the supply date is unknown (null), never guessed.
export function supplyPlan(part, {qty = null, needBy = null, today}){
  const stock = part.stock ?? 0;
  const fromStock = qty == null ? stock > 0 : stock >= qty;
  const supplyWeeks = fromStock ? 0 : part.lead ?? null;
  const coverage = qty == null || part.stock == null ? null : Math.min(1, stock / qty);
  if (supplyWeeks == null) return {fromStock, supplyWeeks, coverage, date:null, onTime:null, late:null};
  const date = addWeeks(today, supplyWeeks);
  const late = needBy ? Math.max(0, Math.ceil(daysBetween(needBy, date) / 7)) : null;
  return {fromStock, supplyWeeks, coverage, date, onTime: needBy ? date <= needBy : null, late};
}

function plan(o, r, required, demand){
  const approval = approvalPath(o, r, required);
  const supply = supplyPlan(r.part, demand);
  if (supply.supplyWeeks == null) return {approval, supply, usableWeeks:null, usableDate:null, onTime:null, lateWeeks:0};
  const usableWeeks = Math.max(supply.supplyWeeks, approval.weeks);
  const usableDate = addWeeks(demand.today, usableWeeks);
  const onTime = demand.needBy ? usableDate <= demand.needBy : null;
  const lateWeeks = demand.needBy && !onTime ? Math.ceil(daysBetween(demand.needBy, usableDate) / 7) : 0;
  return {approval, supply, usableWeeks, usableDate, onTime, lateWeeks};
}

// Equivalent: usable by the need date first (when given), then the smallest change
// (drop-in, minor, major), then fit (no review items first),
// then soonest usable in production (approval and supply), then lead time and stock.
// Better than: only parts that improve something and give nothing up, most upgrades first.
// candidates: the demo catalog by default, or live parts from the Worker. A live part
// without capacitance, case, voltage or a supported dielectric can't be checked, so it's
// counted in `unchecked` instead of being guessed at.
export const isCheckable = p => p.cap != null && p.pkg != null && p.v != null && DIEL_RANK[p.diel] != null;
export function rank(o, {mode, required, demand = {}, candidates = CATALOG}){
  demand = {qty:null, needBy:null, today:new Date(), ...demand};
  const pool = candidates.filter(p => p.pn !== o.pn && p.cap === o.cap);
  const unchecked = pool.filter(p => !isCheckable(p)).length;
  const results = pool.filter(isCheckable).map(p => {
    const r = evaluate(o, p, required);
    if (r.verdict !== "bad"){
      r.plan = plan(o, r, required, demand);
      r.change = changeType(r.plan.approval);
      r.cost = costPlan(o, p, demand.qty);
    }
    return r;
  });
  const inf = n => n ?? Infinity;
  const byAvailability = (a, b) => (inf(a.part.lead) - inf(b.part.lead) || 0) || (b.part.stock ?? -1) - (a.part.stock ?? -1);
  const byFit = (a, b) => (b.plan.onTime === true) - (a.plan.onTime === true)
    || a.change.order - b.change.order || VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || a.flags.length - b.flags.length
    || (inf(a.plan.usableWeeks) - inf(b.plan.usableWeeks) || 0) || byAvailability(a, b);

  const passing = results.filter(r => r.verdict !== "bad");
  const ruledOut = results.filter(r => r.verdict === "bad").sort(byAvailability);
  let fits = passing, equivalentOnly = 0;
  if (mode === "better"){
    fits = passing.filter(r => r.upgrades.length);
    equivalentOnly = passing.length - fits.length;
    fits.sort((a, b) => b.upgrades.length - a.upgrades.length || byFit(a, b));
  } else {
    fits.sort(byFit);
  }
  // Waiting for the original is the baseline every alternate competes with.
  const original = o.fromPart ? supplyPlan(o, demand) : null;
  return {
    fits, ruledOut, equivalentOnly, unchecked, demand, original,
    dropIns: fits.filter(r => r.change.type === "dropin").length,
    minor: fits.filter(r => r.change.type === "minor").length,
    major: fits.filter(r => r.change.type === "major").length,
    originalCost: o.usd != null ? costPlan(o, o, demand.qty) : null,
    onTime: demand.needBy ? fits.filter(r => r.plan.onTime).length : null
  };
}


/* ---------- Live pricing ---------- */
// Unit price at a quantity: the highest break at or below it. Below the first break -> null.
export function unitPriceAt(priceBreaks, qty){
  let price = null;
  for (const b of [...priceBreaks].sort((a, b) => a.qty - b.qty)) if (b.qty <= qty) price = b.price;
  return price;
}

// What you actually buy: at least the MOQ, rounded up to the order multiple.
export function orderQuantity(qty, {moq, multiple}){
  let q = Math.max(qty, moq || 0);
  if (multiple > 1) q = Math.ceil(q / multiple) * multiple;
  return q;
}

// The offer to quote for a live part: among offers priced in USD, those whose stock covers the
// order quantity first, then the lowest spend (unit price × order quantity, so a cheap reel
// doesn't win when you need a few hundred). Without a quantity, each offer is priced at its MOQ.
// Returns null when no distributor lists a USD price; the page then shows no price.
export function bestOffer(offers, qty){
  const quotes = (offers || []).map(offer => {
    const breaks = (offer.priceBreaks || []).filter(b => b.currency === "USD");
    const orderQty = orderQuantity(qty ?? 1, offer);
    return {offer, orderQty, unit: breaks.length ? unitPriceAt(breaks, orderQty) : null};
  }).filter(q => q.unit != null);
  quotes.sort((a, b) => ((b.offer.stock ?? 0) >= b.orderQty) - ((a.offer.stock ?? 0) >= a.orderQty) || a.unit * a.orderQty - b.unit * b.orderQty);
  return quotes[0] || null;
}

// A live part priced for this demand: usd is the unit price of the best offer, or null.
export function priceLive(part, qty){
  const quote = bestOffer(part.offers, qty);
  return {...part, usd: quote ? quote.unit : null, quote};
}
