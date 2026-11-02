// Cloudflare Worker: live part data for the MLCC alternate finder.
//
//   GET /part?mpn=GRM188R71H104KA93D
//   -> {mpn, source, fetchedAt, part, candidates, alternatesError, errors}
//
// part and candidates use the shape rules.js checks (see parts.js). Nexar (Octopart) is the
// primary source; Mouser is the fallback when Nexar fails or its quota is used up.
// Keys live in Worker secrets and never reach the browser. Answers are cached for
// CACHE_SECONDS per part, and alternates per capacitance/case/dielectric, to save quota.

import {MPN_QUERY, SEARCH_QUERY, nexarQuery, normalizeNexarResults} from "./nexar.js";
import {mouserRequest, mouserKeywordRequest, normalizeMouserResponse} from "./mouser.js";
import {fromNexar, fromMouser, alternatesQuery} from "./parts.js";

const CACHE_SECONDS = 6 * 60 * 60;
const ALTERNATES_LIMIT = 20; // each part returned counts against the Nexar quota
const MPN_RE = /^[A-Za-z0-9][A-Za-z0-9\-./#+]{2,59}$/;

// ALLOWED_ORIGIN can list several origins, comma-separated (the site and a local dev server).
function cors(request, env){
  const allowed = (env.ALLOWED_ORIGIN || "https://andreevazquez.github.io").split(",").map(s => s.trim());
  const origin = request.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}

async function cached(key, compute, ctx){
  const cache = globalThis.caches?.default;
  const req = new Request(`https://cache.local/${key}`);
  const hit = cache && await cache.match(req);
  if (hit) return hit.json();
  const value = await compute();
  // Only cache answers without errors, so a failure is retried on the next visit.
  if (cache && !value.error){
    const res = new Response(JSON.stringify(value), {headers: {"Cache-Control": `public, max-age=${CACHE_SECONDS}`}});
    ctx.waitUntil(cache.put(req, res));
  }
  return value;
}

const message = e => e?.message || "couldn’t be reached";

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
  const res = await fetch(url, init);
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

      let candidates = [], alternatesError = null;
      if (part.cap != null && part.pkg){
        try {
          candidates = (await cached(`${src.name}/alt/${part.cap}/${part.pkg}/${part.diel || "any"}`,
            async () => ({parts: await src.alternates(part, env)}), ctx)).parts
            .filter(c => c.cap === part.cap && c.pkg === part.pkg && c.pn.toUpperCase() !== mpn.toUpperCase());
        } catch (e){ alternatesError = message(e); }
      }
      return {source: src.name, fetchedAt, part, candidates, alternatesError, errors};
    } catch (e){
      errors[src.name] = message(e);
      if (e.quota) errors.quota = true;
    }
  }
  return {source: null, fetchedAt: null, part: null, candidates: [], alternatesError: null, errors};
}

export default {
  async fetch(request, env, ctx){
    const headers = {"Content-Type": "application/json; charset=utf-8", ...cors(request, env)};
    const json = (body, status = 200) => new Response(JSON.stringify(body), {status, headers});
    if (request.method === "OPTIONS") return new Response(null, {headers: cors(request, env)});
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/part") return json({error: "Not found"}, 404);

    const mpn = (url.searchParams.get("mpn") || "").trim();
    if (!MPN_RE.test(mpn)) return json({error: "Give a manufacturer part number, like ?mpn=GRM188R71H104KA93D"}, 400);

    const result = await lookUp(mpn, env, ctx);
    return json({mpn, ...result});
  }
};
