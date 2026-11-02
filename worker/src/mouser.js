// Mouser Search API adapter: request building and response normalisation.
// Pure functions, so they run under `node --test` as well as in the Worker.
//
// FIELD NAMES ARE UNVERIFIED. They follow Mouser's Search API v1 as documented
// publicly, but no real response has been checked yet. The first step with
// network access is to call the API for a known part and compare (see NEXT_STEPS.md).

export const MOUSER_ENDPOINT = "https://api.mouser.com/api/v1/search/partnumber";

export function mouserRequest(mpn, apiKey){
  return {
    url: `${MOUSER_ENDPOINT}?apiKey=${encodeURIComponent(apiKey)}`,
    init: {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({SearchByPartRequest: {mouserPartNumber: mpn, partSearchOptions: "Exact"}})
    }
  };
}

// "$0.10", "0.10", "1,234.50" -> number. Anything unparseable -> null.
export function parsePrice(s){
  const n = parseFloat(String(s ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

// "26 Weeks", "10 Days" -> weeks. Anything else -> null.
export function parseLeadTime(s){
  const m = String(s ?? "").match(/(\d+(?:\.\d+)?)\s*(week|day)/i);
  if (!m) return null;
  const n = parseFloat(m[1]);
  return m[2].toLowerCase() === "day" ? Math.ceil(n / 7) : n;
}

const int = v => {
  const n = parseInt(String(v ?? "").replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};

// One Mouser part -> the shape the page uses. Missing data stays null; nothing is filled in.
export function normalizeMouserPart(p){
  const attrs = Object.fromEntries((p.ProductAttributes || []).map(a => [a.AttributeName, a.AttributeValue]));
  return {
    source: "Mouser",
    mpn: p.ManufacturerPartNumber ?? null,
    distributorPn: p.MouserPartNumber ?? null,
    manufacturer: p.Manufacturer ?? null,
    description: p.Description ?? null,
    stock: int(p.AvailabilityInStock) ?? int(p.Availability),
    leadWeeks: parseLeadTime(p.LeadTime),
    moq: int(p.Min),
    multiple: int(p.Mult),
    packaging: attrs.Packaging ?? null,
    lifecycle: p.LifecycleStatus || null,
    datasheet: p.DataSheetUrl || null,
    url: p.ProductDetailUrl || null,
    priceBreaks: (p.PriceBreaks || [])
      .map(b => ({qty: int(b.Quantity), price: parsePrice(b.Price), currency: b.Currency ?? null}))
      .filter(b => b.qty != null && b.price != null)
      .sort((a, b) => a.qty - b.qty)
  };
}

// Keep only exact manufacturer-part-number matches (Mouser can return near matches).
export function normalizeMouserResponse(json, mpn){
  const errors = json?.Errors || [];
  if (errors.length) return {error: errors.map(e => e.Message || e.Code || "Mouser error").join("; ")};
  const want = mpn.trim().toUpperCase();
  const parts = (json?.SearchResults?.Parts || [])
    .filter(p => String(p.ManufacturerPartNumber || "").toUpperCase() === want)
    .map(normalizeMouserPart);
  return {parts};
}

// Unit price at a quantity: the highest break at or below it. Below the first break -> null.
export function unitPriceAt(priceBreaks, qty){
  let price = null;
  for (const b of priceBreaks) if (b.qty <= qty) price = b.price;
  return price;
}

// What you actually buy: at least the MOQ, rounded up to the order multiple.
export function orderQuantity(qty, {moq, multiple}){
  let q = Math.max(qty, moq || 0);
  if (multiple > 1) q = Math.ceil(q / multiple) * multiple;
  return q;
}
