import {test, describe, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {getNexarToken, resetNexarToken, nexarQuery, normalizeNexarMpn, normalizeNexarPart,
        alternatesFilters, isQuotaMessage, MPN_QUERY, ALTERNATES_QUERY} from "../worker/src/nexar.js";
import {lookup, resetQuotaBackoff, cacheSeconds} from "../worker/src/index.js";

// Hand-written parts in the documented Nexar shape. Values are invented for the tests.
const spec = (shortname, displayValue, value = displayValue, units = "") =>
  ({attribute: {shortname, name: shortname}, displayValue, value, units});
const nexarPart = (mpn, {cap = "100 nF", capValue = "1e-07", pkg = "0603", diel = "X7R", qual = null, life = "Production",
                          sellers} = {}) => ({
  mpn, manufacturer: {name: "Test Mfr"}, shortDescription: "Test MLCC", bestDatasheet: {url: "https://example.com/ds.pdf"},
  specs: [spec("capacitance", cap, capValue, "F"), spec("voltagerating_dc_", "50 V"), spec("case_package", pkg),
          spec("dielectric", diel), spec("tolerance", "±10%"), spec("lifecyclestatus", life),
          ...(qual ? [spec("qualification", qual)] : [])],
  sellers: sellers ?? [
    {company: {name: "Dist A"}, offers: [{sku: "A-1", inventoryLevel: 5000, moq: 1, orderMultiple: 1, packaging: "Cut Tape",
      factoryLeadDays: 70, updated: "2026-11-01T00:00:00Z", clickUrl: "https://example.com/a",
      prices: [{quantity: 1, price: 0.1, currency: "USD", convertedPrice: 0.1, convertedCurrency: "USD"},
               {quantity: 1000, price: 0.02, currency: "USD", convertedPrice: 0.02, convertedCurrency: "USD"}]}]},
    {company: {name: "Dist B"}, offers: [{sku: "B-1", inventoryLevel: 0, moq: 4000, orderMultiple: 4000, packaging: "Reel",
      factoryLeadDays: null, prices: [{quantity: 4000, price: 0.9, currency: "MXN", convertedPrice: null, convertedCurrency: null}]}]}
  ]
});
const MPN_DATA = {supSearchMpn: {results: [
  {part: {...nexarPart("TEST-NEXAR-1"), similarParts: [nexarPart("TEST-ALT-1", {qual: "AEC-Q200"}), nexarPart("TEST-ALT-2")]}},
  {part: nexarPart("TEST-NEXAR-1X")}
]}};
const SEARCH_DATA = {supSearch: {results: [{part: nexarPart("TEST-ALT-2")}, {part: nexarPart("TEST-ALT-3", {diel: "X7S"})}]}};

const ENV = {NEXAR_CLIENT_ID: "id", NEXAR_CLIENT_SECRET: "secret", MOUSER_API_KEY: "mk"};
const res = (status, body) => ({ok: status >= 200 && status < 300, status, json: async () => body});

// A stub fetch that answers by URL and records the calls.
function stub(routes){
  const calls = [];
  const fn = async (url, init) => {
    calls.push({url, init});
    for (const [match, answer] of routes) if (url.includes(match)) return typeof answer === "function" ? answer(url, init) : answer;
    throw new TypeError("network down");
  };
  fn.calls = calls;
  return fn;
}
const TOKEN = ["identity.nexar.com", res(200, {access_token: "tok", expires_in: 3600})];

beforeEach(() => { resetNexarToken(); resetQuotaBackoff(); });

describe("Nexar adapter", () => {
  test("token is requested with client credentials and cached until it expires", async () => {
    const f = stub([TOKEN]);
    assert.equal(await getNexarToken(ENV, f, 0), "tok");
    assert.equal(await getNexarToken(ENV, f, 1000), "tok");
    assert.equal(f.calls.length, 1);
    const body = new URLSearchParams(f.calls[0].init.body);
    assert.equal(body.get("grant_type"), "client_credentials");
    assert.equal(body.get("client_id"), "id");
    await getNexarToken(ENV, f, 3600 * 1000);
    assert.equal(f.calls.length, 2, "asks again once expired");
  });
  test("queries carry the bearer token and the MPN", async () => {
    const f = stub([TOKEN, ["api.nexar.com", res(200, {data: MPN_DATA})]]);
    await nexarQuery(ENV, MPN_QUERY, {mpn: "TEST-NEXAR-1"}, f);
    const q = f.calls[1];
    assert.equal(q.init.headers.Authorization, "Bearer tok");
    assert.deepEqual(JSON.parse(q.init.body).variables, {mpn: "TEST-NEXAR-1"});
  });
  test("a quota answer is flagged so the Worker can fall back", async () => {
    assert.ok(isQuotaMessage("Monthly part limit exceeded"));
    assert.ok(!isQuotaMessage("Syntax error"));
    const f = stub([TOKEN, ["api.nexar.com", res(200, {errors: [{message: "You have exceeded your part limit"}]})]]);
    await assert.rejects(nexarQuery(ENV, MPN_QUERY, {mpn: "X"}, f), e => e.quota === true);
    const g = stub([TOKEN, ["api.nexar.com", res(429, {})]]);
    await assert.rejects(nexarQuery(ENV, MPN_QUERY, {mpn: "X"}, g), e => e.quota === true);
  });
  test("normalises specs and offers; USD prices only", () => {
    const p = normalizeNexarPart(nexarPart("TEST-NEXAR-1"));
    assert.deepEqual([p.cap, p.v, p.pkg, p.diel, p.tol, p.grade, p.life], [100000, 50, "0603", "X7R", 10, "commercial", "Active"]);
    const [a, b] = p.offers;
    assert.deepEqual([a.distributor, a.stock, a.moq, a.multiple, a.packaging, a.leadWeeks], ["Dist A", 5000, 1, 1, "Cut Tape", 10]);
    assert.deepEqual(a.priceBreaks, [{qty: 1, price: 0.1}, {qty: 1000, price: 0.02}]);
    assert.deepEqual([b.leadWeeks, b.priceBreaks], [null, []], "no lead time and no USD price stay empty");
    assert.deepEqual(alternatesFilters(p.raw), {capacitance: ["1e-07"], case_package: ["0603"]});
  });
  test("exact MPN match only, with its similar parts", () => {
    const {part, alternates} = normalizeNexarMpn(MPN_DATA, "test-nexar-1");
    assert.equal(part.pn, "TEST-NEXAR-1");
    assert.deepEqual(alternates.map(a => [a.pn, a.grade]), [["TEST-ALT-1", "automotive"], ["TEST-ALT-2", "commercial"]]);
    assert.deepEqual(normalizeNexarMpn(MPN_DATA, "NOPE"), {part: null, alternates: []});
  });
});

describe("Worker lookup", () => {
  const nexarOk = (url, init) => res(200, {data: JSON.parse(init.body).query === ALTERNATES_QUERY ? SEARCH_DATA : MPN_DATA});

  test("Nexar first: part plus similar and parametric alternates, merged by MPN", async () => {
    const f = stub([TOKEN, ["api.nexar.com", nexarOk]]);
    const body = await lookup("TEST-NEXAR-1", ENV, f);
    assert.equal(body.source, "Nexar");
    assert.equal(body.part.pn, "TEST-NEXAR-1");
    assert.equal(body.part.raw, undefined, "internal fields aren’t sent");
    assert.deepEqual(body.alternates.map(a => a.pn), ["TEST-ALT-1", "TEST-ALT-2", "TEST-ALT-3"]);
    assert.deepEqual(body.errors, {});
    assert.equal(cacheSeconds(body), 6 * 3600);
    assert.ok(!f.calls.some(c => c.url.includes("mouser")), "Mouser isn’t called when Nexar answers");
  });
  test("Nexar quota used up: Mouser answers, the page is told, and Nexar is skipped for a while", async () => {
    const mouserPart = {ManufacturerPartNumber: "TEST-NEXAR-1", Manufacturer: "Test Mfr", AvailabilityInStock: "10",
      ProductAttributes: [{AttributeName: "Capacitance", AttributeValue: "100 nF"}, {AttributeName: "Case Code - in", AttributeValue: "0603"}],
      PriceBreaks: []};
    const f = stub([TOKEN,
      ["api.nexar.com", res(200, {errors: [{message: "Monthly part limit exceeded"}]})],
      ["search/partnumber", res(200, {Errors: [], SearchResults: {Parts: [mouserPart]}})],
      ["search/keyword", res(200, {Errors: [], SearchResults: {Parts: [mouserPart, {...mouserPart, ManufacturerPartNumber: "TEST-M-ALT"}]}})]]);
    const body = await lookup("TEST-NEXAR-1", ENV, f);
    assert.equal(body.source, "Mouser");
    assert.deepEqual(body.alternates.map(a => a.pn), ["TEST-M-ALT"]);
    assert.match(body.errors.nexar, /quota/);
    assert.ok(body.notices.some(n => /quota is used up/.test(n)));
    assert.equal(cacheSeconds(body), 3600, "fallback answers are cached for less time");

    const before = f.calls.filter(c => c.url.includes("api.nexar.com")).length;
    await lookup("TEST-NEXAR-1", ENV, f);
    assert.equal(f.calls.filter(c => c.url.includes("api.nexar.com")).length, before, "Nexar not called again during the backoff");
  });
  test("both sources down: no part, both errors, nothing cached", async () => {
    const body = await lookup("TEST-NEXAR-1", ENV, stub([]));
    assert.equal(body.part, null);
    assert.deepEqual(Object.keys(body.errors).sort(), ["mouser", "nexar"]);
    assert.equal(cacheSeconds(body), 0);
  });
  test("no keys configured says so", async () => {
    const body = await lookup("X-123", {}, stub([]));
    assert.deepEqual(body.errors, {nexar: "Nexar isn’t configured", mouser: "Mouser isn’t configured"});
  });
});
