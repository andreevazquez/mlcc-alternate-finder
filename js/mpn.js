// Reads MLCC specs from the part number itself, for listings whose description has none
// (Mouser often shows only "RECOMMENDED ALT …" for a part being phased out).
// Covers the part-number formats of Murata, Samsung, TDK, KEMET and Yageo general-purpose series.
// Units follow rules.js: cap in pF, v in volts, tol in percent. A code it doesn't know stays null.

// Three-character EIA code in pF: "104" -> 10×10^4, "1R0" -> 1.0, "R50" -> 0.5.
export function eiaCap(code){
  const c = String(code ?? "").toUpperCase();
  if (/^\d{2}[0-6]$/.test(c)) return Number(c.slice(0, 2)) * 10 ** Number(c[2]);
  if (/^\d?R\d{1,2}$/.test(c) && c.length === 3) return Number(c.replace("R", "."));
  return null;
}

// Tolerance letter. B, C and D are absolute (pF) tolerances, which rules.js doesn't compare.
const TOL = {F: 1, G: 2, J: 5, K: 10, M: 20, Z: 80};

// JIS voltage codes, used by Murata and TDK.
const JIS_V = {"0E": 2.5, "0G": 4, "0J": 6.3, "1A": 10, "1C": 16, "1E": 25, "YA": 35, "1V": 35,
  "1H": 50, "1J": 63, "2A": 100, "2D": 200, "2E": 250, "2W": 450, "2J": 630, "3A": 1000};

// Metric case size (TDK) -> imperial.
const METRIC = {"0402": "01005", "0603": "0201", "1005": "0402", "1608": "0603", "2012": "0805",
  "3216": "1206", "3225": "1210", "4532": "1812", "5750": "2220"};
const IMPERIAL = new Set(Object.values(METRIC));

// Thickness codes, in mm (maximum nominal height). A code not listed stays null rather than guessed.
const MURATA_H = {2: 0.2, 3: 0.3, 5: 0.5, 6: 0.6, 7: 0.7, 8: 0.8, 9: 0.85, A: 1.0, B: 1.25, C: 1.6, D: 2.0, E: 2.5, M: 1.15, N: 1.35, Q: 1.5, R: 1.8};
const SAMSUNG_H = {3: 0.3, 5: 0.5, 8: 0.8, A: 0.65, C: 0.85, F: 1.25, Q: 1.25, H: 1.6};
const MURATA_CASE = {"02": "01005", "03": "0201", "15": "0402", "18": "0603", "21": "0805", "31": "1206", "32": "1210", "43": "1812", "55": "2220"};
const MURATA_DIEL = {R7: "X7R", R6: "X5R", "5C": "C0G", C7: "X7S", C8: "X6S", D7: "X7T", R9: "X8R"};
const TDK_AUTO_CASE = {2: "0402", 3: "0603", 4: "0805", 5: "1206", 6: "1210", 8: "1812", 9: "2220"};
const tdkHeight = t => t ? Number(t) / 100 : undefined;

const DIEL = {X7R: "X7R", X5R: "X5R", C0G: "C0G", COG: "C0G", NP0: "C0G", NPO: "C0G", X7S: "X7S", X6S: "X6S", X7T: "X7T", X8R: "X8R", Y5V: "Y5V"};

const FORMATS = [
  // Murata: GRM188R71H104KA93D = series, case 18 (0603), height 8 (0.8 mm), dielectric R7, voltage 1H,
  // cap 104, tolerance K. GCJ and GRJ are Murata's soft-termination series; the others are standard.
  {re: /^(GRM|GCM|GCJ|GRJ|GJM|GRT|GQM|GCG)(\d{2})([0-9A-Z])([0-9A-Z]{2})([0-9A-Z]{2})([0-9R]{3})([A-Z])/,
    map: ([, series, size, h, diel, v, cap, tol]) => ({
      mfr: "Murata", auto: series === "GCM" || series === "GCJ", pkg: MURATA_CASE[size], h: MURATA_H[h], diel: MURATA_DIEL[diel],
      v: JIS_V[v], cap: eiaCap(cap), tol: TOL[tol], term: series === "GCJ" || series === "GRJ" ? "flex" : "standard"})},
  // Samsung: CL10B104KB8NNNC = case 10 (0603), dielectric B (X7R), cap 104, tolerance K, voltage B (50 V).
  // The character after the voltage is the thickness (8 = 0.8 mm).
  {re: /^CL(\d{2})([A-Z])([0-9R]{3})([A-Z])([A-Z])([0-9A-Z])?/,
    map: ([, size, diel, cap, tol, v, h]) => ({
      mfr: "Samsung", h: SAMSUNG_H[h],
      pkg: {"03": "0201", "05": "0402", "10": "0603", "21": "0805", "31": "1206", "32": "1210", "43": "1812", "55": "2220"}[size],
      diel: {A: "X5R", B: "X7R", C: "C0G", X: "X6S", Y: "X7S", F: "Y5V"}[diel],
      v: {R: 4, Q: 6.3, P: 10, O: 16, A: 25, L: 35, B: 50, C: 100, D: 200, E: 250, H: 630, I: 1000}[v],
      cap: eiaCap(cap), tol: TOL[tol]})},
  // TDK: C1608X7R1H104K080AC = metric case 1608 (0603), dielectric, voltage 1H, cap 104, tolerance K,
  // thickness 080 (0.80 mm).
  {re: /^C(\d{4})(X7R|X5R|C0G|X7S|X6S|X7T|X8R|NP0)(\d[A-Z])([0-9R]{3})([A-Z])(\d{3})?/,
    map: ([, size, diel, v, cap, tol, h]) => ({mfr: "TDK", pkg: METRIC[size], diel: DIEL[diel], v: JIS_V[v], cap: eiaCap(cap), tol: TOL[tol], h: tdkHeight(h)})},
  // TDK automotive: CGA3E2X7R1H104K080AA = CGA, size 3 (0603), then as above.
  {re: /^CGA(\d)[A-Z]\d(X7R|X5R|C0G|X7S|X6S|X7T|X8R|NP0)(\d[A-Z])([0-9R]{3})([A-Z])(\d{3})?/,
    map: ([, size, diel, v, cap, tol, h]) => ({mfr: "TDK", auto: true, pkg: TDK_AUTO_CASE[size], diel: DIEL[diel], v: JIS_V[v], cap: eiaCap(cap), tol: TOL[tol], h: tdkHeight(h)})},
  // KEMET: C0603C104K5RACTU = imperial case, style C, cap 104, tolerance K, voltage 5 (50 V), dielectric R (X7R).
  // Style X is KEMET's flexible termination (FT-CAP); style C is standard.
  {re: /^C(\d{4})([CX])([0-9R]{3})([A-Z])([0-9A-Z])([A-Z])/,
    map: ([, size, style, cap, tol, v, diel]) => ({
      mfr: "KEMET", pkg: IMPERIAL.has(size) ? size : undefined, term: style === "X" ? "flex" : "standard",
      diel: {G: "C0G", R: "X7R", P: "X5R", V: "Y5V"}[diel],
      v: {9: 6.3, 8: 10, 4: 16, 3: 25, 6: 35, 5: 50, 1: 100, 2: 200, A: 250}[v],
      cap: eiaCap(cap), tol: TOL[tol]})},
  // Yageo: CC0603KRX7R9BB104 = imperial case, tolerance K, packing R, dielectric, voltage 9 (50 V), cap 104.
  {re: /^(?:CC|AC)(\d{4})([A-Z])[A-Z](X7R|X5R|NPO|NP0|C0G|COG|X7S|X6S|Y5V)(\d)BB([0-9R]{3})/,
    map: ([, size, tol, diel, v, cap]) => ({
      mfr: "Yageo", pkg: IMPERIAL.has(size) ? size : undefined, diel: DIEL[diel],
      v: {5: 6.3, 6: 10, 7: 16, 8: 25, 9: 50, 0: 100}[v], cap: eiaCap(cap), tol: TOL[tol]})},
  // KYOCERA AVX: 06035C104KAT2A = imperial case, voltage 5 (50 V), dielectric C (X7R), cap 104, tolerance K,
  // failure rate A (4 = automotive).
  {re: /^(\d{4})([0-9A-Z])([ACDG])([0-9R]{3})([A-Z])([A4])/,
    map: ([, size, v, diel, cap, tol, rate]) => ({mfr: "KYOCERA AVX", auto: rate === "4",
      pkg: IMPERIAL.has(size) ? size : undefined, diel: {A: "C0G", C: "X7R", D: "X5R", G: "Y5V"}[diel],
      v: {4: 4, 6: 6.3, Z: 10, Y: 16, 3: 25, D: 35, 5: 50, 1: 100, 2: 200}[v], cap: eiaCap(cap), tol: TOL[tol]})}
];

// "GRM188R71H104KA93D" -> {cap: 100000, v: 50, pkg: "0603", diel: "X7R", tol: 10, h: 0.8, term: "standard",
//   mfr: "Murata", auto: false}   (auto: an AEC-Q200 automotive series such as GCM, GCJ or CGA)
// or null when the format isn't one of the above. Fields it can't read are null.
export function decodeMpn(mpn){
  const s = String(mpn ?? "").trim().toUpperCase();
  for (const {re, map} of FORMATS){
    const m = s.match(re);
    if (!m) continue;
    const r = map(m);
    const out = {cap: r.cap ?? null, v: r.v ?? null, pkg: r.pkg ?? null, diel: r.diel ?? null, tol: r.tol ?? null,
      h: r.h ?? null, term: r.term ?? null, mfr: r.mfr, auto: !!r.auto};
    return out.cap != null ? out : null;
  }
  return null;
}

const SPEC_FIELDS = ["cap", "v", "pkg", "diel", "tol"];
// Height and termination are never in a distributor description, so they always come from the
// part number when it encodes them; they aren't listed in decoded.
const BUILD_FIELDS = ["h", "term"];

// Fills the specs a listing left out with those read from the part number. A listing's own value
// always wins. decoded lists the datasheet specs that came from the part number, so the page can say so.
export function fillFromMpn(part){
  const dec = decodeMpn(part.pn);
  if (!dec) return {h: null, term: null, ...part, decoded: []};
  const decoded = SPEC_FIELDS.filter(k => part[k] == null && dec[k] != null);
  const filled = Object.fromEntries([...decoded, ...BUILD_FIELDS.filter(k => part[k] == null)].map(k => [k, dec[k]]));
  return {...part, ...filled, decoded};
}
