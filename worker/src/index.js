// Cloudflare Worker: live part data for the MLCC alternate finder.
//
//   GET /part?mpn=GRM188R71H104KA93D  ->  {mpn, fetchedAt, sources:{mouser:{parts|error}}}
//
// API keys live in Worker secrets (wrangler secret put MOUSER_API_KEY) and never reach the browser.
// Responses are cached for CACHE_SECONDS to stay inside the free API limits.
// Digi-Key is the next source to add (see NEXT_STEPS.md).

import {mouserRequest, normalizeMouserResponse} from "./mouser.js";

const CACHE_SECONDS = 6 * 60 * 60;
const MPN_RE = /^[A-Za-z0-9][A-Za-z0-9\-./#+]{2,59}$/;

function cors(env){
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "https://andreevazquez.github.io",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Vary": "Origin"
  };
}
const json = (body, status, env, extra = {}) =>
  new Response(JSON.stringify(body), {status, headers: {"Content-Type": "application/json", ...cors(env), ...extra}});

async function fromMouser(mpn, env){
  if (!env.MOUSER_API_KEY) return {error: "Mouser isn’t configured"};
  const {url, init} = mouserRequest(mpn, env.MOUSER_API_KEY);
  try {
    const res = await fetch(url, init);
    if (!res.ok) return {error: `Mouser answered ${res.status}`};
    return normalizeMouserResponse(await res.json(), mpn);
  } catch {
    return {error: "Mouser couldn’t be reached"};
  }
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

    const body = {mpn, fetchedAt: new Date().toISOString(), sources: {mouser: await fromMouser(mpn, env)}};
    const res = json(body, 200, env, {"Cache-Control": `public, max-age=${CACHE_SECONDS}`});
    // Only cache answers that came back without errors.
    if (!body.sources.mouser.error) ctx.waitUntil(cache.put(key, res.clone()));
    return res;
  }
};
