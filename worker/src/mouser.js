// Mouser Search API adapter: request building and response normalisation.
// Pure functions, so they run under `node --test` as well as in the Worker.
//
// FIELD NAMES ARE UNVERIFIED. They follow Mouser's Search API v1 as documented
// publicly, but no real response has been checked yet. The first step with
// network access is to call the API for a known part and compare (see NEXT_STEPS.md).

export const MOUSER_ENDPOINT = "https://api.mouser.com/api/v1/search/partnumber";
export const MOUSER_KEYWORD_ENDPOINT = "https://api.mouser.com/api/v1/search/keyword";

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

// Keyword search, used for alternates when Nexar is unavailable ("0.1uF 0603 X7R").
export function mouserKeywordRequest(keyword, apiKey, records = 50){
  return {
    url: `${MOUSER_KEYWORD_ENDPOINT}?apiKey=${encodeURIComponent(apiKey)}`,
    init: {
      method: "POST",
      headers: {"Content-Type": "application/json", "Accept": "application/json"},
      body: JSON.stringify({SearchByKeywordRequest: {keyword, records, startingRecord: 0}})
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
  // An attribute can repeat (Packaging: Reel, Cut Tape, MouseReel), so keep every value.
  const attrs = {};
  for (const a of p.ProductAttributes || []) (attrs[a.AttributeName] ||= []).push(a.AttributeValue);
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
    packaging: attrs.Packaging ? attrs.Packaging.join(", ") : null,
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
// mpn = null keeps every result (keyword search).
export function normalizeMouserResponse(json, mpn = null){
  const errors = json?.Errors || [];
  if (errors.length) return {error: errors.map(e => e.Message || e.Code || "Mouser error").join("; ")};
  const want = mpn?.trim().toUpperCase();
  const parts = (json?.SearchResults?.Parts || [])
    .filter(p => !want || String(p.ManufacturerPartNumber || "").toUpperCase() === want)
    .map(normalizeMouserPart);
  return {parts};
}

// Pricing helpers are shared with the page.
export {unitPriceAt, orderQuantity} from "../../rules.js";
