// Spec parsing shared by the Nexar and Mouser adapters.
// Every parser returns null when it can't read the value: missing data stays missing.

const UNIT_PF = {p: 1, n: 1e3, u: 1e6, "µ": 1e6, "μ": 1e6, m: 1e9, "": 1e12};

// "100 nF", "0.1µF", "100000pF", "1e-07" (with units "F") -> picofarads.
export function parseCapacitance(s, units){
  const t = String(s ?? "").trim();
  if (!t) return null;
  const m = t.match(/^([0-9]*\.?[0-9]+(?:e[-+]?\d+)?)\s*([pnuµμm]?)\s*F?$/i);
  if (!m) return null;
  let prefix = m[2];
  if (!prefix && !/F$/i.test(t) && !/^F$/i.test(String(units ?? "").trim())) return null;
  prefix = prefix === "U" ? "u" : prefix === "N" ? "n" : prefix === "P" ? "p" : prefix;
  const pf = parseFloat(m[1]) * UNIT_PF[prefix];
  return Number.isFinite(pf) && pf > 0 ? Math.round(pf * 1000) / 1000 : null;
}

// "50 V", "50VDC", "50 V (DC)" -> 50.
export function parseVoltage(s){
  const m = String(s ?? "").match(/([0-9]*\.?[0-9]+)\s*(k?)V/i);
  if (!m) return null;
  return parseFloat(m[1]) * (m[2] ? 1000 : 1);
}

// "0603 (1608 Metric)", "0603", "0603 (1608 metric)" -> "0603". Imperial EIA codes only.
const CASES = ["01005", "0201", "0402", "0603", "0805", "1206", "1210", "1812", "2220"];
export function parseCase(s){
  const t = String(s ?? "");
  const m = t.match(/\b(01005|0201|0402|0603|0805|1206|1210|1812|2220)\b/);
  if (!m) return null;
  // "1608 Metric" alone isn't the imperial 0603; only accept codes not labelled metric.
  const after = t.slice(m.index + m[0].length, m.index + m[0].length + 8);
  return /metric/i.test(after) ? null : CASES.includes(m[1]) ? m[1] : null;
}

// "X7R", "C0G, NP0", "NP0", "COG" -> "C0G"; other EIA codes (X6S, X7S, X8R…) are kept as given.
export function parseDielectric(s){
  const t = String(s ?? "").toUpperCase();
  if (/\b(C0G|COG|NP0|NPO)\b/.test(t)) return "C0G";
  const m = t.match(/\b([XYZ][4-9][P-V])\b/);
  return m ? m[1] : null;
}

// "±10%", "10 %", "+/-5%" -> 10, 5. "+80%, -20%" (Y5V style) -> 80, its worst case.
// Absolute tolerances like "±0.25pF" -> null: the rules compare percentages.
export function parseTolerance(s){
  const t = String(s ?? "");
  const all = [...t.matchAll(/([0-9]*\.?[0-9]+)\s*%/g)].map(m => parseFloat(m[1]));
  return all.length ? Math.max(...all) : null;
}

// Lifecycle wording varies by source. Unknown wording -> null (shows as "not verified").
export function parseLifecycle(s){
  const t = String(s ?? "").toLowerCase();
  if (!t) return null;
  if (/not recommended|nrnd/.test(t)) return "NRND";
  if (/obsolete|eol|end of life|discontinued|last time buy/.test(t)) return "EOL";
  if (/production|active|new product|new at/.test(t)) return "Active";
  return null;
}

// AEC-Q200 anywhere in the qualification or description -> automotive. Never infers medical.
export const parseGrade = (...texts) => texts.some(t => /AEC-?Q200/i.test(String(t ?? ""))) ? "automotive" : "commercial";

export const int = v => {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v) : null;
  const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
