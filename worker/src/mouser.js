// Mouser Search API adapter: request building and response normalisation.
// Pure functions, so they run under `node --test` as well as in the Worker.
// Mouser is the fallback when Nexar fails or its quota runs out.
//
// FIELD NAMES ARE UNVERIFIED. They follow Mouser's Search API v1 as documented
// publicly, but no real response has been checked yet (see NEXT_STEPS.md).

import {parseCapacitance, parseVoltage, parseCase, parseDielectric, parseTolerance,
        parseLifecycle, parseGrade, int} from "./specs.js";

export const MOUSER_ENDPOINT = "https://api.mouser.com/api/v1/search/partnumber";
export const MOUSER_KEYWORD_ENDPOINT = "https://api.mouser.com/api/v1/search/keyword";

const post = (url, apiKey, body) => ({
  url: `${url}?apiKey=${encodeURIComponent(apiKey)}`,
  init: {
    method: "POST",
    headers: {"Content-Type": "application/json", "Accept": "application/json"},
    body: JSON.stringify(body)
  }
});

export const mouserRequest = (mpn, apiKey) =>
  post(MOUSER_ENDPOINT, apiKey, {SearchByPartRequest: {mouserPartNumber: mpn, partSearchOptions: "Exact"}});

// Keyword search for alternates, e.g. "100nF 50V 0603 X7R ceramic capacitor".
export const mouserKeywordRequest = (keyword, apiKey) =>
  post(MOUSER_KEYWORD_ENDPOINT, apiKey, {SearchByKeywordRequest: {keyword, records: 50, startingRecord: 0}});

// The keyword that finds parts with the same capacitance and case.
export function alternatesKeyword(part){
  if (part?.cap == null || !part?.pkg) return null;
  const pf = part.cap;
  const cap = pf >= 1e6 ? `${pf / 1e6}uF` : pf >= 1e3 ? `${pf / 1e3}nF` : `${pf}pF`;
  return `${cap} ${part.pkg} ceramic capacitor`;
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

// One Mouser part -> the shape the page uses (same as Nexar's, with one offer). Missing data stays null.
export function normalizeMouserPart(p){
  const attrs = {};
  for (const a of p.ProductAttributes || []){
    // Packaging can repeat (Reel, Cut Tape, MouseReel); keep them all.
    attrs[a.AttributeName] = attrs[a.AttributeName] ? `${attrs[a.AttributeName]}, ${a.AttributeValue}` : a.AttributeValue;
  }
  return {
    pn: p.ManufacturerPartNumber ?? null,
    mfr: p.Manufacturer ?? null,
    description: p.Description ?? null,
    cap: parseCapacitance(attrs.Capacitance),
    v: parseVoltage(attrs["Voltage Rating DC"] ?? attrs["Voltage Rating"]),
    pkg: parseCase(attrs["Case Code - in"] ?? attrs["Package / Case"]),
    diel: parseDielectric(attrs.Dielectric),
    tol: parseTolerance(attrs.Tolerance),
    grade: parseGrade(attrs.Qualification, p.Description),
    life: parseLifecycle(p.LifecycleStatus),
    datasheet: p.DataSheetUrl || null,
    offers: [{
      distributor: "Mouser",
      sku: p.MouserPartNumber ?? null,
      stock: int(p.AvailabilityInStock) ?? int(p.Availability),
      moq: int(p.Min),
      multiple: int(p.Mult),
      packaging: attrs.Packaging ?? null,
      leadWeeks: parseLeadTime(p.LeadTime),
      priceBreaks: (p.PriceBreaks || [])
        .filter(b => (b.Currency ?? "USD") === "USD")
        .map(b => ({qty: int(b.Quantity), price: parsePrice(b.Price)}))
        .filter(b => b.qty != null && b.price != null)
        .sort((a, b) => a.qty - b.qty),
      url: p.ProductDetailUrl || null,
      updated: null
    }]
  };
}

const errorsOf = json => (json?.Errors || []).map(e => e.Message || e.Code || "Mouser error").join("; ");

// Keep only exact manufacturer-part-number matches (Mouser can return near matches).
// Mouser lists the same MPN once per packaging; those become several offers of one part.
export function normalizeMouserResponse(json, mpn){
  const err = errorsOf(json);
  if (err) return {error: err};
  const want = mpn.trim().toUpperCase();
  const parts = (json?.SearchResults?.Parts || [])
    .filter(p => String(p.ManufacturerPartNumber || "").toUpperCase() === want)
    .map(normalizeMouserPart);
  return {parts, part: mergeOffers(parts)[0] ?? null};
}

export function normalizeMouserKeyword(json){
  const err = errorsOf(json);
  if (err) return {error: err};
  return {parts: mergeOffers((json?.SearchResults?.Parts || []).map(normalizeMouserPart))};
}

// Same MPN listed several times (one per packaging) -> one part with several offers.
export function mergeOffers(parts){
  const by = new Map();
  for (const p of parts){
    const k = String(p.pn ?? "").toUpperCase();
    if (!k) continue;
    if (by.has(k)) by.get(k).offers.push(...p.offers);
    else by.set(k, {...p, offers: [...p.offers]});
  }
  return [...by.values()];
}
