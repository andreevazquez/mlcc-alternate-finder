// Map distributor data to the part shape rules.js checks:
//   {pn, mfr, description, cap, v, pkg, diel, tol, grade, life, stock, lead, offers, datasheet, url, source}
// Units follow rules.js: cap in picofarads, v in volts, tol in percent (+80/−20 stored as 80), lead in weeks.
// Anything that can't be parsed stays null: the page then says it's missing instead of guessing.

const CASES = ["01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812", "2220"];

// "100nF", "0.1 µF", "100 pF", "0.1uF" -> pF
export function parseCapacitance(s){
  const m = String(s ?? "").replace(/µ|μ/g, "u").match(/(\d+(?:\.\d+)?)\s*(p|n|u|m)?F\b/i);
  if (!m) return null;
  const mult = {p: 1, n: 1e3, u: 1e6, m: 1e9}[(m[2] || "").toLowerCase()] ?? 1e12;
  return Math.round(parseFloat(m[1]) * mult);
}

// "50V", "50 VDC", "50volts", "50 V" -> 50
export function parseVoltage(s){
  const m = String(s ?? "").match(/(\d+(?:\.\d+)?)\s*(?:v|vdc|volts?)\b/i);
  return m ? parseFloat(m[1]) : null;
}

// "0603 (1608 Metric)" -> "0603". Only imperial codes; a bare metric code is left alone.
export function parseCase(s){
  const t = String(s ?? "");
  for (const c of CASES) if (new RegExp(`(^|[^0-9])${c}(?![0-9])(?!\\s*metric)`, "i").test(t)) return c;
  return null;
}

// "X7R" -> "X7R"; "C0G, NP0", "COG", "NPO" -> "C0G". Other classes (X6S, X7S, X8R…) -> their name,
// which rules.js doesn't rank, so such a part is listed as not checkable rather than misjudged.
export function parseDielectric(s){
  const t = String(s ?? "").toUpperCase();
  if (/\b(C0G|COG|NP0|NPO)\b/.test(t)) return "C0G";
  const m = t.match(/\b([XYZ]\d[A-Z])\b/);
  return m ? m[1] : null;
}

// "±10%" -> 10; "+80%, -20%" -> 80; "±0.25pF" -> null (absolute tolerances aren't compared)
export function parseTolerance(s){
  const t = String(s ?? "");
  if (/\+\s*80\s*%/.test(t)) return 80;
  const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
  return m ? parseFloat(m[1]) : null;
}

// Lifecycle text -> "Active" | "NRND" | "EOL" | null
export function parseLifecycle(s){
  const t = String(s ?? "").toLowerCase();
  if (!t) return null;
  if (/obsolete|end of life|\beol\b|discontinued|last time buy/.test(t)) return "EOL";
  if (/nrnd|not recommended/.test(t)) return "NRND";
  if (/production|active|new product|new at mouser/.test(t)) return "Active";
  return null;
}

// AEC-Q200 named in the specs or description -> automotive. Otherwise commercial: a part
// not listed as AEC-Q200 is never treated as qualified.
export const parseGrade = (...texts) => texts.some(t => /AEC-?Q200/i.test(String(t ?? ""))) ? "automotive" : "commercial";

const pick = (specs, ...patterns) => {
  for (const re of patterns) for (const [k, v] of Object.entries(specs)) if (re.test(k)) return v;
  return null;
};

const sum = xs => xs.reduce((n, x) => n + x, 0);
// The middle value. Distributors that stock a part often quote their own shipping time (1 week)
// as the lead time, so the shortest quote understates the factory lead time; the median doesn't.
export function median(xs){
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
// Stock and lead time across the offers: total authorised stock, median quoted factory lead time.
function supply(offers){
  const stocks = offers.map(o => o.stock).filter(n => n != null);
  const leads = offers.map(o => o.leadWeeks).filter(n => n != null);
  return {stock: stocks.length ? sum(stocks) : null, lead: median(leads)};
}

// A part from nexar.js normalizeNexarPart.
export function fromNexar(p){
  const s = p.specs || {};
  return {
    source: "Nexar", pn: p.mpn, mfr: p.manufacturer, description: p.description,
    cap: parseCapacitance(pick(s, /^capacitance$/i)),
    v: parseVoltage(pick(s, /voltage.*rat|rated voltage|^voltage/i)),
    pkg: parseCase(pick(s, /^case\/package$/i, /case code|case|package/i)),
    diel: parseDielectric(pick(s, /dielectric|temperature coefficient/i)),
    tol: parseTolerance(pick(s, /^tolerance$/i)),
    grade: parseGrade(pick(s, /qualification/i), p.description),
    life: parseLifecycle(pick(s, /lifecycle/i)),
    ...supply(p.offers || []),
    offers: p.offers || [],
    datasheet: p.datasheet, url: p.url
  };
}

// Mouser lists most specs only in the description, e.g.
// "Multilayer Ceramic Capacitors MLCC - SMD/SMT 0603 0.1uF 50volts X7R 10%".
// Several Mouser results with the same MPN (reel, cut tape) become one part with several offers.
export function fromMouser(parts){
  const byMpn = new Map();
  for (const p of parts){
    const key = String(p.mpn || "").toUpperCase();
    if (!key) continue;
    const offer = {
      seller: "Mouser", sku: p.distributorPn, stock: p.stock, moq: p.moq, multiple: p.multiple,
      leadWeeks: p.leadWeeks, packaging: p.packaging, url: p.url, updated: null, priceBreaks: p.priceBreaks
    };
    if (byMpn.has(key)){ byMpn.get(key).offers.push(offer); continue; }
    const d = p.description || "";
    const recommendedAlt = d.match(/\bRECOMMENDED\s+ALT(?:ERNATE)?\s+([A-Z0-9][A-Z0-9-]{2,})/i)?.[1] || null;
    byMpn.set(key, {
      source: "Mouser", pn: p.mpn, mfr: p.manufacturer, description: d,
      cap: parseCapacitance(d), v: parseVoltage(d), pkg: parseCase(d), diel: parseDielectric(d),
      tol: parseTolerance(d), grade: parseGrade(d), life: parseLifecycle(p.lifecycle),
      offers: [offer], datasheet: p.datasheet, url: p.url, recommendedAlt
    });
  }
  return [...byMpn.values()].map(p => {
    // Mouser offers for one MPN share one stock pool, so take the largest instead of adding them up.
    const stocks = p.offers.map(o => o.stock).filter(n => n != null);
    const leads = p.offers.map(o => o.leadWeeks).filter(n => n != null);
    return {...p, stock: stocks.length ? Math.max(...stocks) : null, lead: median(leads)};
  });
}

// Words for the alternates search: "100nF 0603 X7R ceramic capacitor".
export function alternatesQuery(part, withType = true){
  const cap = part.cap >= 1e6 ? `${part.cap / 1e6}uF` : part.cap >= 1e3 ? `${part.cap / 1e3}nF` : `${part.cap}pF`;
  return [cap, part.pkg, part.diel, withType && "ceramic capacitor"].filter(Boolean).join(" ");
}
