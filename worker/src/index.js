// Cloudflare Worker: live part data for the MLCC alternate finder.
//
//   GET /part?mpn=GRM188R71H104KA93D
//   -> {mpn, source, fetchedAt, part, candidates, alternatesError, errors}
//   GET /fx
//   -> {date, perUsd: {USD, MXN, EUR}, source}   ECB reference rates, for the page's currency selector
//
// part and candidates use the shape rules.js checks (see parts.js). Nexar (Octopart) is the
// primary source; Mouser is the fallback when Nexar fails or its quota is used up.
// Keys live in Worker secrets and never reach the browser. Answers are cached for
// CACHE_SECONDS per part, and alternates per capacitance/case/dielectric, to save quota.
// Only the site's own origins get CORS headers; every response carries security headers.

import {MPN_QUERY, SEARCH_QUERY, nexarQuery, normalizeNexarResults} from "./nexar.js";
import {mouserRequest, mouserKeywordRequest, normalizeMouserResponse} from "./mouser.js";
import {UPSTREAM_TIMEOUT_MS} from "./nexar.js";
import {FX_URL, FX_SOURCE, parseRates} from "../../js/fx.js";
import {fromNexar, fromMouser, alternatesQuery} from "./parts.js";

// Short: stock and prices move during the day, but a burst of lookups for one part costs one call.
const CACHE_SECONDS = 30 * 60;
const FX_CACHE_SECONDS = 6 * 60 * 60; // the ECB publishes once per working day
// Bump when the shape of a cached answer changes, so old answers aren't served after a deploy.
const CACHE_VERSION = "v3";
const ALTERNATES_LIMIT = 10; // each part returned counts against the Nexar quota
const MPN_RE = /^[A-Za-z0-9][A-Za-z0-9\-./#+]{2,59}$/;

// ALLOWED_ORIGIN can list several origins, comma-separated (the site and a local dev server).
// Any other origin gets no Access-Control-Allow-Origin header, so its browser blocks the response.
function cors(request, env){
  const allowed = (env.ALLOWED_ORIGIN || "https://andreevazquez.github.io").split(",").map(s => s.trim());
  const origin = request.headers.get("Origin");
  return {
    ...(allowed.includes(origin) ? {"Access-Control-Allow-Origin": origin} : {}),
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

// JSON only: nothing in a response may run, be framed or leak the referrer.
export const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains"
};

async function cached(key, compute, ctx, seconds = CACHE_SECONDS){
  const cache = globalThis.caches?.default;
  const req = new Request(`https://cache.local/${CACHE_VERSION}/${key}`);
  const hit = cache && await cache.match(req);
  if (hit) return hit.json();
  const value = await compute();
  // Only cache answers without errors, so a failure is retried on the next visit.
  if (cache && !value.error){
    const res = new Response(JSON.stringify(value), {headers: {"Cache-Control": `public, max-age=${seconds}`}});
    ctx.waitUntil(cache.put(req, res));
  }
  return value;
}

const message = e => e?.name === "TimeoutError" || e?.name === "AbortError" ? `didn’t answer within ${UPSTREAM_TIMEOUT_MS / 1000} s` : e?.message || "couldn’t be reached";
const record = (errors, name, e) => {
  errors[name] = message(e);
  if (e?.detail) errors[`${name}Detail`] = e.detail;
  if (e?.quota) errors.quota = true;
  if (e?.planLimit) errors.planLimit = true;
  if (e?.rateLimit) errors.rateLimit = true;
};

/* ---------- Nexar ---------- */
async function nexarPart(mpn, env){
  const data = await nexarQuery(env, MPN_QUERY, {q: mpn, limit: 3});
  return normalizeNexarResults(data.supSearchMpn, mpn).parts.map(fromNexar)[0] || null;
}
async function nexarAlternates(part, env){
  const data = await nexarQuery(env, SEARCH_QUERY, {q: alternatesQuery(part), limit: ALTERNATES_LIMIT});
  return normalizeNexarResults(data.supSearch).parts.map(fromNexar);
}

/* ---------- Mouser ---------- */
async function mouserCall({url, init}){
  const res = await fetch(url, {...init, signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)});
  if (!res.ok) throw new Error(`Mouser answered ${res.status}`);
  return res.json();
}
async function mouserPart(mpn, env){
  const r = normalizeMouserResponse(await mouserCall(mouserRequest(mpn, env.MOUSER_API_KEY)), mpn);
  if (r.error) throw new Error(`Mouser: ${r.error}`);
  return fromMouser(r.parts)[0] || null;
}
async function mouserAlternates(part, env){
  const r = normalizeMouserResponse(await mouserCall(mouserKeywordRequest(alternatesQuery(part, false), env.MOUSER_API_KEY)));
  if (r.error) throw new Error(`Mouser: ${r.error}`);
  return fromMouser(r.parts);
}

const SOURCES = [
  {name: "Nexar", configured: env => env.NEXAR_CLIENT_ID && env.NEXAR_CLIENT_SECRET, part: nexarPart, alternates: nexarAlternates},
  {name: "Mouser", configured: env => env.MOUSER_API_KEY, part: mouserPart, alternates: mouserAlternates}
];

// Tries each source in order. errors records why a source was skipped; quota marks an exhausted plan.
export async function lookUp(mpn, env, ctx){
  const errors = {};
  for (const src of SOURCES){
    if (!src.configured(env)){ errors[src.name] = `${src.name} isn’t configured`; continue; }
    try {
      // fetchedAt travels with the cached answer, so the page shows the data's real age.
      const {part, fetchedAt} = await cached(`${src.name}/part/${encodeURIComponent(mpn.toUpperCase())}`,
        async () => ({part: await src.part(mpn, env), fetchedAt: new Date().toISOString()}), ctx);
      if (!part){ errors[src.name] = `${src.name} doesn’t list ${mpn}`; continue; }

      // Alternates: from the same source first, then from the next one that's configured.
      let candidates = [], alternatesError = null, alternatesSource = null;
      if (part.cap != null && part.pkg){
        for (const alt of SOURCES.slice(SOURCES.indexOf(src)).filter(s => s.configured(env))){
          try {
            candidates = (await cached(`${alt.name}/alt/${part.cap}/${part.pkg}/${part.diel || "any"}`,
              async () => ({parts: await alt.alternates(part, env)}), ctx)).parts
              .filter(c => c.cap === part.cap && c.pkg === part.pkg && c.pn.toUpperCase() !== mpn.toUpperCase());
            alternatesSource = alt.name;
            alternatesError = null;
            break;
          } catch (e){
            alternatesError = message(e);
            record(errors, `${alt.name}Alternates`, e);
          }
        }
      }
      return {source: src.name, fetchedAt, part, candidates, alternatesSource, alternatesError, errors};
    } catch (e){
      record(errors, src.name, e);
    }
  }
  return {source: null, fetchedAt: null, part: null, candidates: [], alternatesSource: null, alternatesError: null, errors};
}

/* ---------- Exchange rates ---------- */
export async function fxRates(ctx, fetchFn = fetch){
  return cached("fx", async () => {
    const res = await fetchFn(FX_URL, {signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)});
    const rates = res.ok ? parseRates(await res.json()) : null;
    return rates ? {...rates, source: FX_SOURCE} : {error: "Exchange rates aren’t available right now"};
  }, ctx, FX_CACHE_SECONDS);
}

export default {
  async fetch(request, env, ctx){
    const headers = {"Content-Type": "application/json; charset=utf-8", ...SECURITY_HEADERS, ...cors(request, env)};
    const json = (body, status = 200, extraHeaders = {}) => new Response(JSON.stringify(body), {status, headers: {...headers, ...extraHeaders}});
    if (request.method === "OPTIONS") return new Response(null, {status: 204, headers: {...SECURITY_HEADERS, ...cors(request, env)}});
    if (request.method !== "GET") return json({error: "Only GET is supported"}, 405, {"Allow": "GET, OPTIONS"});
    if (request.url.length > 300) return json({error: "Request too long"}, 414);
    const url = new URL(request.url);

    if (url.pathname === "/fx"){
      try {
        const fx = await fxRates(ctx);
        return fx.error ? json(fx, 502) : json(fx, 200, {"Cache-Control": "public, max-age=3600"});
      } catch (e){
        return json({error: `Exchange rates ${message(e)}`}, 502);
      }
    }
    if (url.pathname !== "/part") return json({error: "Not found"}, 404);

    const mpn = (url.searchParams.get("mpn") || "").trim();
    if ([...url.searchParams.keys()].some(k => k !== "mpn") || !MPN_RE.test(mpn))
      return json({error: "Give one manufacturer part number, like ?mpn=GRM188R71H104KA93D"}, 400);

    // Fail closed if rate limiting is missing: this public endpoint consumes provider quota.
    const clientIp = request.headers.get("CF-Connecting-IP");
    if (!env.MLCC_LIMITER || !clientIp) return json({error: "Request protection is unavailable"}, 503);
    const {success} = await env.MLCC_LIMITER.limit({key: clientIp});
    if (!success) return json({error: "Too many requests. Try again in a minute."}, 429, {"Retry-After": "60"});

    const result = await lookUp(mpn, env, ctx);
    return json({mpn, ...result});
  }
};
