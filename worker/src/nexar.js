// Nexar (Octopart) Supply API adapter: token, queries and response normalisation.
// Pure functions except getNexarToken/nexarQuery, which take fetch as an argument so tests can stub it.
//
// FIELD NAMES ARE UNVERIFIED against a live response. They follow the Nexar Supply schema
// (supSearchMpn, supSearch, sellers → offers, specs → attribute.shortname) as documented
// publicly. Check them in the Nexar playground before trusting the output (see NEXT_STEPS.md).

import {parseCapacitance, parseVoltage, parseCase, parseDielectric, parseTolerance,
        parseLifecycle, parseGrade, int} from "./specs.js";

export const NEXAR_TOKEN_URL = "https://identity.nexar.com/connect/token";
export const NEXAR_GRAPHQL_URL = "https://api.nexar.com/graphql";

/* ---------- Token ---------- */
// Client-credentials token, kept in memory until a minute before it expires.
let cachedToken = null;
export function resetNexarToken(){ cachedToken = null; }

export async function getNexarToken(env, fetchFn = fetch, now = Date.now()){
  if (cachedToken && cachedToken.expires > now) return cachedToken.value;
  const res = await fetchFn(NEXAR_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "client_credentials", scope: "supply.domain",
      client_id: env.NEXAR_CLIENT_ID, client_secret: env.NEXAR_CLIENT_SECRET
    }).toString()
  });
  if (!res.ok) throw new NexarError(`Nexar sign-in failed (${res.status})`);
  const body = await res.json();
  if (!body.access_token) throw new NexarError("Nexar sign-in returned no token");
  cachedToken = {value: body.access_token, expires: now + ((body.expires_in || 3600) - 60) * 1000};
  return cachedToken.value;
}

export class NexarError extends Error {
  constructor(message, {quota = false} = {}){ super(message); this.quota = quota; }
}

// Quota or rate-limit answers, so the Worker can say so and fall back to Mouser.
export const isQuotaMessage = s => /quota|part limit|limit (has been )?(reached|exceeded)|exceeded|too many requests|rate limit/i.test(String(s ?? ""));

/* ---------- Queries ---------- */
const PART_FIELDS = `
  mpn
  manufacturer { name }
  shortDescription
  bestDatasheet { url }
  specs { attribute { shortname name } displayValue value units }
  sellers(authorizedOnly: true) {
    company { name }
    offers {
      sku inventoryLevel moq orderMultiple packaging factoryLeadDays updated clickUrl
      prices { quantity price currency convertedPrice convertedCurrency }
    }
  }`;

// One MPN with its offers, plus Octopart's similar parts with theirs.
export const MPN_QUERY = `query PartByMpn($mpn: String!) {
  supSearchMpn(q: $mpn, limit: 3, currency: "USD") {
    results { part { ${PART_FIELDS}
      similarParts { ${PART_FIELDS} }
    } }
  }
}`;

// Parametric search: same capacitance and case, for alternates beyond similarParts.
export const ALTERNATES_QUERY = `query Alternates($filters: Map) {
  supSearch(q: "", filters: $filters, limit: 20, currency: "USD", inStockOnly: false) {
    results { part { ${PART_FIELDS} } }
  }
}`;

// Filter values use the attribute's raw value as Nexar reports it in specs.value.
export function alternatesFilters(raw){
  if (!raw?.capacitance || !raw?.case_package) return null;
  return {capacitance: [raw.capacitance], case_package: [raw.case_package]};
}

export async function nexarQuery(env, query, variables, fetchFn = fetch){
  const token = await getNexarToken(env, fetchFn);
  const res = await fetchFn(NEXAR_GRAPHQL_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": `Bearer ${token}`},
    body: JSON.stringify({query, variables})
  });
  if (res.status === 429) throw new NexarError("Nexar’s request limit is reached", {quota: true});
  if (res.status === 401) resetNexarToken();
  if (!res.ok) throw new NexarError(`Nexar answered ${res.status}`);
  const body = await res.json();
  if (body.errors?.length){
    const msg = body.errors.map(e => e.message).join("; ");
    throw new NexarError(isQuotaMessage(msg) ? "Nexar’s monthly part quota is used up" : `Nexar: ${msg}`,
                         {quota: isQuotaMessage(msg)});
  }
  return body.data;
}

/* ---------- Normalisation ---------- */
// Spec lookup by shortname, with fallbacks on the display name.
function specMap(specs = []){
  const by = {};
  for (const s of specs){
    const keys = [s?.attribute?.shortname, s?.attribute?.name].filter(Boolean).map(k => k.toLowerCase());
    for (const k of keys) by[k] = s;
  }
  const find = (...names) => {
    for (const n of names){
      const hit = by[n] || Object.entries(by).find(([k]) => k.includes(n))?.[1];
      if (hit) return hit;
    }
    return null;
  };
  return find;
}

// USD price breaks only, sorted by quantity. Other currencies are dropped, not converted here.
function usdBreaks(prices = []){
  return prices.map(p => {
    const usd = p.convertedCurrency === "USD" && p.convertedPrice != null ? p.convertedPrice
              : p.currency === "USD" ? p.price : null;
    return {qty: int(p.quantity), price: typeof usd === "number" ? usd : parseFloat(usd)};
  }).filter(b => b.qty != null && b.qty > 0 && Number.isFinite(b.price))
    .sort((a, b) => a.qty - b.qty);
}

export function normalizeNexarOffers(sellers = []){
  const offers = [];
  for (const s of sellers || []){
    for (const o of s?.offers || []){
      offers.push({
        distributor: s?.company?.name ?? null,
        sku: o.sku ?? null,
        stock: int(o.inventoryLevel),
        moq: int(o.moq),
        multiple: int(o.orderMultiple),
        packaging: o.packaging || null,
        leadWeeks: o.factoryLeadDays == null ? null : Math.ceil(int(o.factoryLeadDays) / 7),
        priceBreaks: usdBreaks(o.prices),
        url: o.clickUrl || null,
        updated: o.updated || null
      });
    }
  }
  return offers;
}

// One Nexar part -> the shape the page uses. Missing data stays null.
export function normalizeNexarPart(p){
  const spec = specMap(p?.specs);
  const val = s => s?.displayValue ?? s?.value ?? null;
  const cap = spec("capacitance");
  const pkg = spec("case_package", "case/package", "case code (imperial)", "case");
  const qual = spec("qualification");
  return {
    pn: p?.mpn ?? null,
    mfr: p?.manufacturer?.name ?? null,
    description: p?.shortDescription ?? null,
    cap: parseCapacitance(cap?.value, cap?.units) ?? parseCapacitance(cap?.displayValue),
    v: parseVoltage(val(spec("voltagerating_dc_", "voltage rating (dc)", "voltage rating", "voltage"))),
    pkg: parseCase(val(pkg)),
    diel: parseDielectric(val(spec("dielectric", "temperature coefficient"))),
    tol: parseTolerance(val(spec("tolerance"))),
    grade: parseGrade(val(qual), p?.shortDescription),
    life: parseLifecycle(val(spec("lifecyclestatus", "lifecycle status", "lifecycle"))),
    datasheet: p?.bestDatasheet?.url ?? null,
    offers: normalizeNexarOffers(p?.sellers),
    // Raw filter values for the parametric alternates search.
    raw: {capacitance: cap?.value ?? null, case_package: pkg?.value ?? null}
  };
}

const sameMpn = (a, b) => String(a ?? "").toUpperCase() === String(b ?? "").toUpperCase();

// The exact MPN match (or null) and its similar parts.
export function normalizeNexarMpn(data, mpn){
  const results = data?.supSearchMpn?.results || [];
  const hit = results.find(r => sameMpn(r?.part?.mpn, mpn))?.part;
  if (!hit) return {part: null, alternates: []};
  return {part: normalizeNexarPart(hit), alternates: (hit.similarParts || []).map(normalizeNexarPart)};
}

export const normalizeNexarSearch = data => (data?.supSearch?.results || []).map(r => normalizeNexarPart(r?.part));

// Full lookup: the part, then parametric alternates. Similar parts and parametric hits are merged by MPN.
export async function nexarLookup(mpn, env, fetchFn = fetch){
  const {part, alternates} = normalizeNexarMpn(await nexarQuery(env, MPN_QUERY, {mpn}, fetchFn), mpn);
  if (!part) return {part: null, alternates: []};
  const filters = alternatesFilters(part.raw);
  let more = [];
  if (filters){
    try { more = normalizeNexarSearch(await nexarQuery(env, ALTERNATES_QUERY, {filters}, fetchFn)); }
    catch (e){ if (e.quota) throw e; /* similarParts still stand on their own */ }
  }
  return {part, alternates: mergeByMpn(alternates, more).filter(a => !sameMpn(a.pn, part.pn))};
}

export function mergeByMpn(...lists){
  const seen = new Map();
  for (const p of lists.flat()) if (p?.pn && !seen.has(p.pn.toUpperCase())) seen.set(p.pn.toUpperCase(), p);
  return [...seen.values()];
}
