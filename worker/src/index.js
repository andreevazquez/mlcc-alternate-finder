// Cloudflare Worker: live part data for the MLCC alternate finder.
//
//   GET /part?mpn=GRM188R71H104KA93D
//   -> {mpn, fetchedAt, source, part, alternates, notices, errors}
//
// Nexar (Octopart) is the primary source; Mouser is the fallback when Nexar fails or its
// quota runs out. API keys live in Worker secrets and never reach the browser:
//   npx wrangler secret put NEXAR_CLIENT_ID
//   npx wrangler secret put NEXAR_CLIENT_SECRET
//   npx wrangler secret put MOUSER_API_KEY
// Answers are cached for CACHE_SECONDS to stay inside the free API limits.

import {nexarLookup, NexarError} from "./nexar.js";
import {mouserRequest, mouserKeywordRequest, alternatesKeyword,
        normalizeMouserResponse, normalizeMouserKeyword} from "./mouser.js";

export const CACHE_SECONDS = 6 * 60 * 60;
// A Mouser-only answer (Nexar down or out of quota) is kept for less time, so Nexar comes back sooner.
export const FALLBACK_CACHE_SECONDS = 60 * 60;
// After Nexar says its quota is used up, skip it for this long (per Worker instance).
const QUOTA_BACKOFF_MS = 60 * 60 * 1000;
export const MPN_RE = /^[A-Za-z0-9][A-Za-z0-9\-./#+]{2,59}$/;

let nexarBlockedUntil = 0;
export function resetQuotaBackoff(){ nexarBlockedUntil = 0; }

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://andreevazquez.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}
const json = (body, status, env, extra = {}) =>
  new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", ...cors(env), ...extra}});

// Only what the page needs.
const clean = p => p && ({pn: p.pn, mfr: p.mfr, description: p.description, cap: p.cap, v: p.v, pkg: p.pkg,
  diel: p.diel, tol: p.tol, grade: p.grade, life: p.life, datasheet: p.datasheet, offers: p.offers});

async function fromNexar(mpn, env, fetchFn){
  if (!env.NEXAR_CLIENT_ID || !env.NEXAR_CLIENT_SECRET) return {error: "Nexar isn’t configured"};
  if (Date.now() < nexarBlockedUntil) return {error: "Nexar’s monthly part quota is used up", quota: true};
  try {
    return await nexarLookup(mpn, env, fetchFn);
  } catch (e){
    if (e.quota) nexarBlockedUntil = Date.now() + QUOTA_BACKOFF_MS;
    return {error: e instanceof NexarError ? e.message : "Nexar couldn’t be reached", quota: !!e.quota};
  }
}

async function fromMouser(mpn, env, fetchFn){
  if (!env.MOUSER_API_KEY) return {error: "Mouser isn’t configured"};
  try {
    const {url, init} = mouserRequest(mpn, env.MOUSER_API_KEY);
    const res = await fetchFn(url, init);
    if (!res.ok) return {error: `Mouser answered ${res.status}`};
    const found = normalizeMouserResponse(await res.json(), mpn);
    if (found.error) return {error: `Mouser: ${found.error}`};
    if (!found.part) return {part: null, alternates: []};
    let alternates = [];
    const keyword = alternatesKeyword(found.part);
    if (keyword){
      const k = mouserKeywordRequest(keyword, env.MOUSER_API_KEY);
      const kr = await fetchFn(k.url, k.init);
      if (kr.ok){
        const r = normalizeMouserKeyword(await kr.json());
        if (!r.error) alternates = r.parts.filter(p => String(p.pn).toUpperCase() !== mpn.toUpperCase());
      }
    }
    return {part: found.part, alternates};
  } catch {
    return {error: "Mouser couldn’t be reached"};
  }
}

// The lookup itself, separate from HTTP and caching so it can be tested.
export async function lookup(mpn, env, fetchFn = fetch){
  const body = {mpn, fetchedAt: new Date().toISOString(), source: null, part: null, alternates: [], notices: [], errors: {}};
  const nexar = await fromNexar(mpn, env, fetchFn);
  if (!nexar.error && nexar.part){
    return {...body, source: "Nexar", part: clean(nexar.part), alternates: nexar.alternates.map(clean)};
  }
  if (nexar.error) body.errors.nexar = nexar.error;
  if (nexar.quota) body.notices.push("Nexar’s monthly part quota is used up, so this comes from Mouser only.");

  const mouser = await fromMouser(mpn, env, fetchFn);
  if (mouser.error) body.errors.mouser = mouser.error;
  else if (mouser.part){
    if (!nexar.quota && nexar.error) body.notices.push("Nexar didn’t answer, so this comes from Mouser only.");
    if (!nexar.error) body.notices.push("Nexar doesn’t list this part; this comes from Mouser.");
    return {...body, source: "Mouser", part: clean(mouser.part), alternates: mouser.alternates.map(clean)};
  }
  return body;
}

// Clean answers for 6 h; a Mouser fallback for 1 h; errors with nothing found aren't cached.
export function cacheSeconds(body){
  const failed = Object.keys(body.errors).length > 0;
  if (!failed) return CACHE_SECONDS;
  return body.part ? FALLBACK_CACHE_SECONDS : 0;
}

export default {
  async fetch(request, env, ctx){
    if (request.method === "OPTIONS") return new Response(null, {headers: cors(env)});
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/part") return json({error: "Not found"}, 404, env);

    const mpn = (url.searchParams.get("mpn") || "").trim();
    if (!MPN_RE.test(mpn)) return json({error: "Give a manufacturer part number, like ?mpn=GRM188R71H104KA93D"}, 400, env);

    const cache = caches.default;
    const key = new Request(`https://cache.local/part/${encodeURIComponent(mpn.toUpperCase())}`);
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, {headers: {...Object.fromEntries(hit.headers), ...cors(env)}});

    const body = await lookup(mpn, env);
    const seconds = cacheSeconds(body);
    const res = json(body, 200, env, seconds ? {"Cache-Control": `public, max-age=${seconds}`} : {"Cache-Control": "no-store"});
    if (seconds) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
};
