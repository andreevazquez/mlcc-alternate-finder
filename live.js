// Live distributor data: calling the Worker and turning its answer into the parts rules.js ranks.
// Pure functions apart from fetchLive, so they run in the browser and under `node --test`.
// Nothing here invents a value: a field the source doesn't give stays null.

// Unit price at a quantity: the highest break at or below it. Below the first break -> null.
export function unitPriceAt(priceBreaks, qty){
  let price = null;
  for (const b of priceBreaks || []) if (b.qty <= qty) price = b.price;
  return price;
}

// What you actually buy: at least the MOQ, rounded up to the order multiple.
export function orderQuantity(qty, {moq, multiple} = {}){
  let q = Math.max(qty || 0, moq || 0, 1);
  if (multiple > 1) q = Math.ceil(q / multiple) * multiple;
  return q;
}

// One offer at the quantity needed (or its MOQ when no quantity is given).
export function quote(offer, qty){
  const orderQty = orderQuantity(qty, offer);
  const unit = unitPriceAt(offer.priceBreaks, orderQty);
  return {orderQty, unit, total: unit == null ? null : unit * orderQty};
}

const minOf = xs => { const v = xs.filter(x => x != null); return v.length ? Math.min(...v) : null; };

// Offers sorted for the table: priced ones first, by what you'd actually pay for the order
// quantity (a 4,000-piece reel isn't cheaper than cut tape when you need 10), then by stock.
export function quotedOffers(part, qty){
  return (part.offers || []).map(o => ({...o, quote: quote(o, qty)}))
    .sort((a, b) => (a.quote.total == null) - (b.quote.total == null)
      || (a.quote.total ?? 0) - (b.quote.total ?? 0) || (b.stock ?? 0) - (a.stock ?? 0));
}

// A live part -> the shape rules.js uses.
//   stock: total across authorised offers (null if no offer lists stock)
//   lead:  the shortest factory lead time any offer lists (null if none)
//   usd:   the unit price of the cheapest offer for the order quantity, with that offer in `best`
export function toRulesPart(p, {qty = null, source = null, fetchedAt = null} = {}){
  const offers = quotedOffers(p, qty);
  const stocks = offers.map(o => o.stock).filter(s => s != null);
  const best = offers.find(o => o.quote.unit != null) || null;
  return {
    pn: p.pn, mfr: p.mfr, description: p.description ?? null,
    cap: p.cap ?? null, v: p.v ?? null, pkg: p.pkg ?? null, diel: p.diel ?? null, tol: p.tol ?? null,
    grade: p.grade || "commercial", life: p.life ?? null, datasheet: p.datasheet ?? null,
    stock: stocks.length ? stocks.reduce((a, b) => a + b, 0) : null,
    lead: minOf(offers.map(o => o.leadWeeks)),
    usd: best ? best.quote.unit : null,
    best, offers, source, fetchedAt, live: true
  };
}

// "just now", "12 min ago", "2 h ago", "3 days ago".
export function ageText(iso, now = new Date()){
  const ms = now - new Date(iso);
  if (!Number.isFinite(ms)) return "";
  const min = Math.round(ms / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return `${d} day${d > 1 ? "s" : ""} ago`;
}

// Source label for every live number: "Nexar · 2 h ago".
export const sourceLabel = ({source, fetchedAt}, now) => `${source}${fetchedAt ? ` · ${ageText(fetchedAt, now)}` : ""}`;

// The Worker's answer -> {spec, pool, source, fetchedAt, notices} for rank(), or {error}.
export function fromWorker(body, {qty = null} = {}){
  if (!body?.part){
    const why = Object.values(body?.errors || {});
    return {error: why.length ? why.join("; ") : "notfound", errors: body?.errors || {}};
  }
  const meta = {source: body.source, fetchedAt: body.fetchedAt};
  return {
    spec: {...toRulesPart(body.part, {qty, ...meta}), fromPart: true},
    pool: (body.alternates || []).map(a => toRulesPart(a, {qty, ...meta})),
    ...meta,
    notices: body.notices || [],
    errors: body.errors || {}
  };
}

export async function fetchLive(workerUrl, mpn, {fetchFn = fetch, timeoutMs = 15000} = {}){
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${workerUrl.replace(/\/$/, "")}/part?mpn=${encodeURIComponent(mpn)}`, {signal: ctrl.signal});
    if (!res.ok) throw new Error(`The live-data service answered ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
