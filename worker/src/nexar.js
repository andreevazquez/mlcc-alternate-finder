// Nexar (Octopart) Supply API adapter: token, queries and response normalisation.
// Pure apart from nexarToken/nexarQuery, so the parsing runs under `node --test`.
//
// FIELD NAMES ARE UNVERIFIED against a live response. They follow Nexar's published
// Supply schema (supSearchMpn, supSearch, Part, Seller, Offer, PricePoint); check them in
// the playground at https://portal.nexar.com before trusting the output (see NEXT_STEPS.md).

export const NEXAR_TOKEN_URL = "https://identity.nexar.com/connect/token";
export const NEXAR_GRAPHQL_URL = "https://api.nexar.com/graphql";

// Every part returned counts against the monthly quota, so the fields are only what the page uses.
const PART_FIELDS = `
  mpn
  manufacturer { name }
  shortDescription
  octopartUrl
  bestDatasheet { url }
  specs { attribute { name shortname } displayValue }
  sellers(authorizedOnly: true) {
    company { name }
    offers {
      sku inventoryLevel moq orderMultiple factoryLeadDays packaging clickUrl updated
      prices { quantity price currency convertedPrice convertedCurrency }
    }
  }`;

export const MPN_QUERY = `query PartByMpn($q: String!, $limit: Int!) {
  supSearchMpn(q: $q, limit: $limit, currency: "USD") { hits results { part { ${PART_FIELDS} } } }
}`;

// Alternates: a keyword search ("100nF 0603 ceramic capacitor"); the Worker then keeps only
// parts whose parsed capacitance and case match exactly. Nexar's parametric `filters`
// argument would be tighter but its value format isn't verified yet.
export const SEARCH_QUERY = `query Alternates($q: String!, $limit: Int!) {
  supSearch(q: $q, limit: $limit, currency: "USD") { hits results { part { ${PART_FIELDS} } } }
}`;

// Client-credentials token, cached per Worker isolate until a minute before it expires.
let cachedToken = null;
export async function nexarToken(env, fetchFn = fetch, now = Date.now()){
  if (cachedToken && cachedToken.expires > now) return cachedToken.value;
  const res = await fetchFn(NEXAR_TOKEN_URL, {
    method: "POST",
    headers: {"Content-Type": "application/x-www-form-urlencoded"},
    body: new URLSearchParams({
      grant_type: "client_credentials", client_id: env.NEXAR_CLIENT_ID,
      client_secret: env.NEXAR_CLIENT_SECRET, scope: "supply.domain"
    })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) throw new NexarError(`Nexar sign-in failed (${body.error || res.status})`);
  cachedToken = {value: body.access_token, expires: now + ((body.expires_in || 3600) - 60) * 1000};
  return cachedToken.value;
}
export const resetNexarToken = () => { cachedToken = null; };

// detail keeps Nexar's own words, so a quota or plan limit can be told apart from a bad query.
export class NexarError extends Error {
  constructor(message, {quota = false, detail = null} = {}){ super(message); this.quota = quota; this.detail = detail; }
}

// Quota or rate-limit answers, as HTTP status or GraphQL error text.
export const isQuotaError = (status, message = "") =>
  status === 429 || /quota|limit (?:has been )?(?:reached|exceeded)|exceeded|too many/i.test(message);

export async function nexarQuery(env, query, variables, fetchFn = fetch){
  const token = await nexarToken(env, fetchFn);
  const res = await fetchFn(NEXAR_GRAPHQL_URL, {
    method: "POST",
    headers: {"Content-Type": "application/json", "Authorization": `Bearer ${token}`},
    body: JSON.stringify({query, variables})
  });
  const body = await res.json().catch(() => ({}));
  const message = (body.errors || []).map(e => e.message).join("; ");
  if (!res.ok || message){
    const quota = isQuotaError(res.status, message);
    throw new NexarError(quota ? "Nexar’s monthly part quota is used up" : `Nexar answered ${message || res.status}`,
      {quota, detail: message || `HTTP ${res.status}`});
  }
  return body.data;
}

const num = v => (typeof v === "number" && Number.isFinite(v) ? v : null);

// One Nexar offer -> the offer shape the page shows. Prices keep their own currency;
// convertedPrice (requested as USD) is used when the seller quotes another currency.
export function normalizeNexarOffer(seller, o){
  return {
    seller: seller?.company?.name ?? null,
    sku: o.sku ?? null,
    stock: num(o.inventoryLevel),
    moq: num(o.moq),
    multiple: num(o.orderMultiple),
    leadWeeks: num(o.factoryLeadDays) == null ? null : Math.ceil(o.factoryLeadDays / 7),
    packaging: o.packaging || null,
    url: o.clickUrl || null,
    updated: o.updated || null,
    priceBreaks: (o.prices || []).map(p => {
      const usd = p.currency === "USD" ? num(p.price) : p.convertedCurrency === "USD" ? num(p.convertedPrice) : null;
      return usd == null
        ? {qty: num(p.quantity), price: num(p.price), currency: p.currency ?? null}
        : {qty: num(p.quantity), price: usd, currency: "USD"};
    }).filter(b => b.qty != null && b.price != null).sort((a, b) => a.qty - b.qty)
  };
}

// Nexar can list the same offer more than once (one per region feed). Identical ones are merged.
export function dedupeOffers(offers){
  const seen = new Set();
  return offers.filter(o => {
    const key = JSON.stringify([o.seller, o.sku, o.stock, o.moq, o.multiple, o.leadWeeks, o.packaging, o.priceBreaks]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// One Nexar part -> {mpn, manufacturer, description, specs:{name: displayValue}, offers, …}.
export function normalizeNexarPart(p){
  const specs = {};
  for (const s of p.specs || []){
    const name = s.attribute?.name || s.attribute?.shortname;
    if (name && s.displayValue != null) specs[name] = String(s.displayValue);
  }
  return {
    source: "Nexar",
    mpn: p.mpn ?? null,
    manufacturer: p.manufacturer?.name ?? null,
    description: p.shortDescription ?? null,
    specs,
    datasheet: p.bestDatasheet?.url ?? null,
    url: p.octopartUrl ?? null,
    offers: dedupeOffers((p.sellers || []).flatMap(s => (s.offers || []).map(o => normalizeNexarOffer(s, o))))
  };
}

// data.supSearchMpn or data.supSearch -> {parts}. With an mpn, only exact matches.
export function normalizeNexarResults(result, mpn = null){
  const want = mpn?.trim().toUpperCase();
  const parts = (result?.results || [])
    .map(r => r.part).filter(Boolean)
    .filter(p => !want || String(p.mpn || "").toUpperCase() === want)
    .map(normalizeNexarPart);
  return {parts};
}
