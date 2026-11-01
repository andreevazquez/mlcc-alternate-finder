// Pure substitution logic: catalog, parsing, rules, ranking and formatting.
// No DOM access, so it runs unchanged in the browser and under `node --test`.

/* ---------- Data ---------- */
// cap: picofarads · tol: percent (Y5V stored as 80, its worst case) · stock/lead: simulated
const RAW = [
  {pn:"GRM188R71H104KA93D",  mfr:"Murata",      cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:0,       lead:26},
  {pn:"C1608X7R1H104K080AA", mfr:"TDK",         cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:120000,  lead:4},
  {pn:"CL10B104KB8NNNC",     mfr:"Samsung",     cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:480000,  lead:2},
  {pn:"CC0603KRX7R9BB104",   mfr:"Yageo",       cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:950000,  lead:1},
  {pn:"C0603C104K5RACTU",    mfr:"KEMET",       cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:36000,   lead:8},
  {pn:"06035C104KAT2A",      mfr:"KYOCERA AVX", cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:12000,   lead:14},
  {pn:"GCM188R71H104KA57D",  mfr:"Murata",      cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:true,  stock:8000,    lead:22},
  {pn:"CGA3E2X7R1H104K080AA",mfr:"TDK",         cap:100000,   v:50,  pkg:"0603", diel:"X7R", tol:10, auto:true,  stock:64000,   lead:6},
  {pn:"GRM188R72A104KA35D",  mfr:"Murata",      cap:100000,   v:100, pkg:"0603", diel:"X7R", tol:10, auto:false, stock:210000,  lead:3},
  {pn:"CL10F104ZB8NNNC",     mfr:"Samsung",     cap:100000,   v:50,  pkg:"0603", diel:"Y5V", tol:80, auto:false, stock:700000,  lead:1},
  {pn:"GRM155R71C104KA88D",  mfr:"Murata",      cap:100000,   v:16,  pkg:"0402", diel:"X7R", tol:10, auto:false, stock:1500000, lead:2},
  {pn:"CL21B104KBCNNNC",     mfr:"Samsung",     cap:100000,   v:50,  pkg:"0805", diel:"X7R", tol:10, auto:false, stock:300000,  lead:2},
  {pn:"C1608X7R1E104K080AA", mfr:"TDK",         cap:100000,   v:25,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:260000,  lead:3},
  {pn:"GRM21BR61A106KE19L",  mfr:"Murata",      cap:10000000, v:10,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:0,       lead:30},
  {pn:"C2012X5R1A106K125AB", mfr:"TDK",         cap:10000000, v:10,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:40000,   lead:9},
  {pn:"CL21A106KAYNNNE",     mfr:"Samsung",     cap:10000000, v:25,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:220000,  lead:3},
  {pn:"CC0805KKX5R6BB106",   mfr:"Yageo",       cap:10000000, v:10,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:380000,  lead:2},
  {pn:"GRM21BR61E106KA73L",  mfr:"Murata",      cap:10000000, v:25,  pkg:"0805", diel:"X5R", tol:10, auto:false, stock:18000,   lead:12},
  {pn:"CL21B106KOQNNNE",     mfr:"Samsung",     cap:10000000, v:16,  pkg:"0805", diel:"X7R", tol:10, auto:false, stock:90000,   lead:5},
  {pn:"GRM188R61A106KE69D",  mfr:"Murata",      cap:10000000, v:10,  pkg:"0603", diel:"X5R", tol:20, auto:false, stock:500000,  lead:2},
  {pn:"GRM155R61A105KE15D",  mfr:"Murata",      cap:1000000,  v:10,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:0,       lead:24},
  {pn:"C1005X5R1A105K050BB", mfr:"TDK",         cap:1000000,  v:10,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:410000,  lead:2},
  {pn:"CL05A105KA5NQNC",     mfr:"Samsung",     cap:1000000,  v:25,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:1200000, lead:1},
  {pn:"CC0402KRX5R6BB105",   mfr:"Yageo",       cap:1000000,  v:10,  pkg:"0402", diel:"X5R", tol:10, auto:false, stock:85000,   lead:6},
  {pn:"GRM1885C1H101JA01D",  mfr:"Murata",      cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:0,       lead:20},
  {pn:"C1608C0G1H101J080AA", mfr:"TDK",         cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:150000,  lead:3},
  {pn:"C0603C101J5GACTU",    mfr:"KEMET",       cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:44000,   lead:7},
  {pn:"CC0603JRNPO9BN101",   mfr:"Yageo",       cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:false, stock:620000,  lead:1},
  {pn:"GCM1885C1H101JA16D",  mfr:"Murata",      cap:100,      v:50,  pkg:"0603", diel:"C0G", tol:5,  auto:true,  stock:26000,   lead:10},
  {pn:"CL10B101KB8NNNC",     mfr:"Samsung",     cap:100,      v:50,  pkg:"0603", diel:"X7R", tol:10, auto:false, stock:340000,  lead:2}
];
export const CATALOG = Object.freeze(RAW.map(({auto, ...p}) => Object.freeze({...p, grade: auto ? "automotive" : "commercial"})));
export const BY_PN = new Map(CATALOG.map(p => [p.pn, p]));
export const CAP_VALUES = [...new Set(CATALOG.map(p => p.cap))].sort((a, b) => a - b);

export const DIEL_RANK = {Y5V:0, X5R:1, X7R:2, C0G:3};
export const DIEL_TEMP = {Y5V:"−30 to 85 °C", X5R:"−55 to 85 °C", X7R:"−55 to 125 °C", C0G:"−55 to 125 °C"};

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
export const fmtStock = n => n === 0 ? "None" : n >= 1e6 ? trimNum(n / 1e6) + "M" : n >= 1000 ? Math.round(n / 1000) + "k" : String(n);

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

/* ---------- Rules ---------- */
// Each check: {state: ok|warn|bad|info, text}. "info" never changes the verdict.
// upgrades: the specs where the candidate is strictly better than what's required.
export function evaluate(o, c, required){
  const checks = [], upgrades = [];
  const add = (state, text) => checks.push({state, text});

  add(c.cap === o.cap ? "ok" : "bad",
      c.cap === o.cap ? `Capacitance ${fmtCap(c.cap)}` : `Capacitance ${fmtCap(c.cap)}, needs ${fmtCap(o.cap)}`);

  if (o.pkg == null)        add("warn", `Case ${c.pkg}: you didn’t give one, confirm the footprint`);
  else if (c.pkg === o.pkg) add("ok",   `Case ${c.pkg}, same footprint`);
  else                      add("bad",  `Case ${c.pkg} won’t fit the ${o.pkg} footprint`);

  if (o.v == null)      add("warn", `Rated ${c.v} V: you didn’t give a voltage, confirm it covers the circuit`);
  else if (c.v === o.v) add("ok",   `Rated ${c.v} V`);
  else if (c.v > o.v){  add("warn", `Rated ${c.v} V, up from ${o.v} V: check part height`); upgrades.push(`${c.v} V vs ${o.v} V`); }
  else                  add("bad",  `Rated ${c.v} V, below the ${o.v} V required`);

  if (o.diel == null)                             add("warn", `Dielectric ${c.diel}: you didn’t give one, confirm with engineering`);
  else if (c.diel === o.diel)                     add("ok",   `Dielectric ${c.diel}`);
  else if (DIEL_RANK[c.diel] > DIEL_RANK[o.diel]){ add("warn", `${c.diel} instead of ${o.diel}: more stable, confirm with engineering`); upgrades.push(`${c.diel} vs ${o.diel}`); }
  else                                            add("bad",  `${c.diel} is a downgrade from ${o.diel}: drifts more with temperature and voltage`);

  if (o.tol == null)        add("info", `Tolerance ${fmtTol(c.tol)}`);
  else if (c.tol === o.tol) add("ok",   `Tolerance ${fmtTol(c.tol)}`);
  else if (c.tol < o.tol){  add("ok",   `Tolerance ${fmtTol(c.tol)}, tighter than needed`); upgrades.push(`${fmtTol(c.tol)} vs ${fmtTol(o.tol)}`); }
  else                      add("bad",  `Tolerance ${fmtTol(c.tol)}, looser than ${fmtTol(o.tol)}`);

  if (!meetsGrade(c.grade, required)){
    add("bad", required === "medical"
      ? `${GRADES[c.grade].label}, not released for medical use`
      : `${GRADES[c.grade].label} grade; ${GRADES[required].label} required`);
  } else if (c.grade === required){
    add("ok", required === "commercial" ? "Commercial grade" : `${GRADES[c.grade].label}, as required`);
  } else {
    add("ok", `${GRADES[c.grade].label}, above the ${GRADES[required].short} requirement`);
    upgrades.push(GRADES[c.grade].short);
  }

  if (o.mfr) add("info", c.mfr === o.mfr ? "Same manufacturer: simplest approval" : "New manufacturer: needs an approved-vendor-list entry");

  const verdict = checks.some(k => k.state === "bad") ? "bad" : checks.some(k => k.state === "warn") ? "warn" : "ok";
  return {part:c, checks, verdict, upgrades, fails:checks.filter(k => k.state === "bad").map(k => k.text)};
}

// Equivalent: best fit, then soonest available, then most stock.
// Better than: only parts that improve something and give nothing up, most upgrades first.
export function rank(o, {mode, required}){
  const results = CATALOG.filter(p => p.pn !== o.pn && p.cap === o.cap).map(p => evaluate(o, p, required));
  const byAvailability = (a, b) => a.part.lead - b.part.lead || b.part.stock - a.part.stock;
  const byFit = (a, b) => VERDICT_ORDER[a.verdict] - VERDICT_ORDER[b.verdict] || byAvailability(a, b);

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
  return {
    fits, ruledOut, equivalentOnly,
    dropIns: fits.filter(r => r.verdict === "ok").length,
    reviews: fits.filter(r => r.verdict === "warn").length
  };
}
