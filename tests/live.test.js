import {test, describe, beforeEach} from "node:test";
import assert from "node:assert/strict";
import {normalizeNexarResults, nexarToken, resetNexarToken, isQuotaError, isPlanLimitError, isRateLimitError, dedupeOffers} from "../worker/src/nexar.js";
import {
  parseCapacitance, parseVoltage, parseCase, parseDielectric, parseTolerance, parseLifecycle,
  parseGrade, fromNexar, fromMouser, alternatesQuery, median
} from "../worker/src/parts.js";
import worker, {lookUp} from "../worker/src/index.js";
import {rank, bestOffer, priceLive, isCheckable} from "../js/rules.js";

// Hand-written responses in the documented shapes, to test the parsing only.
// Part numbers and values are invented and never shown on the page.
const nexarPart = (mpn, specs, offers = []) => ({
  mpn, manufacturer: {name: "Test Mfr"}, shortDescription: "Test capacitor", octopartUrl: "https://example.com/p",
  bestDatasheet: {url: "https://example.com/ds.pdf"},
  specs: Object.entries(specs).map(([name, displayValue]) => ({attribute: {name, shortname: name.toLowerCase()}, displayValue})),
  sellers: offers
});
const SPECS = {"Capacitance": "100nF", "Voltage Rating": "50V", "Case/Package": "0603", "Dielectric": "X7R",
               "Tolerance": "10%", "Lifecycle Status": "Production (Last Updated: 1 month ago)"};
const SELLERS = [
  {company: {name: "Distributor A"}, offers: [{
    sku: "A-1", inventoryLevel: 4000, moq: 1, orderMultiple: 1, factoryLeadDays: 70, packaging: "Cut Tape",
    clickUrl: "https://example.com/a", updated: "2026-11-01T00:00:00Z",
    prices: [{quantity: 1, price: 0.1, currency: "USD"}, {quantity: 1000, price: 0.01, currency: "USD"}]}]},
  {company: {name: "Distributor B"}, offers: [{
    sku: "B-1", inventoryLevel: 300000, moq: 4000, orderMultiple: 4000, factoryLeadDays: null, packaging: "Reel",
    prices: [{quantity: 4000, price: 0.004, currency: "EUR", convertedPrice: 0.0045, convertedCurrency: "USD"}]}]}
];
const NEXAR = {results: [
  {part: nexarPart("TEST-1", SPECS, SELLERS)},
  {part: nexarPart("TEST-1X", SPECS)}
]};

describe("Nexar adapter", () => {
  test("keeps exact MPN matches and normalises offers", () => {
    const {parts} = normalizeNexarResults(NEXAR, "test-1");
    assert.equal(parts.length, 1);
    const [a, b] = parts[0].offers;
    assert.deepEqual([a.seller, a.stock, a.moq, a.leadWeeks, a.packaging], ["Distributor A", 4000, 1, 10, "Cut Tape"]);
    assert.equal(b.leadWeeks, null);
    assert.deepEqual(b.priceBreaks, [{qty: 4000, price: 0.0045, currency: "USD"}], "uses the USD conversion");
  });
  test("without an MPN keeps every result", () => {
    assert.equal(normalizeNexarResults(NEXAR).parts.length, 2);
  });
  test("token is cached until it expires", async () => {
    resetNexarToken();
    let calls = 0;
    const fake = async () => { calls++; return {ok: true, json: async () => ({access_token: "t" + calls, expires_in: 3600})}; };
    const env = {NEXAR_CLIENT_ID: "id", NEXAR_CLIENT_SECRET: "s"};
    assert.equal(await nexarToken(env, fake, 0), "t1");
    assert.equal(await nexarToken(env, fake, 1000), "t1");
    assert.equal(await nexarToken(env, fake, 3600 * 1000), "t2");
    resetNexarToken();
  });
  test("merges identical offers", () => {
    const a = {seller: "D", sku: "1", stock: 5, priceBreaks: [{qty: 1, price: 1, currency: "USD"}]};
    assert.equal(dedupeOffers([a, {...a}, {...a, stock: 6}]).length, 2);
  });
  test("lead time is the median quote, not a distributor’s shipping time", () => {
    assert.equal(median([52, 52, 1, 1, 61, 36, 36, 53]), 44);
    assert.equal(median([1, 52, 61]), 52);
    assert.equal(median([]), null);
  });
  test("recognises quota answers", () => {
    assert.ok(isRateLimitError(429));
    assert.ok(!isQuotaError(429));
    assert.ok(isQuotaError(200, "Monthly part limit exceeded"));
    assert.ok(!isQuotaError(200, "You have exceeded your part limit of 10. Please upgrade your plan."));
    assert.ok(isPlanLimitError(200, "You have exceeded your part limit of 10. Please upgrade your plan."));
    assert.ok(isRateLimitError(200, "Too many requests"));
    assert.ok(!isQuotaError(200, "Syntax error"));
  });
});

describe("spec parsing", () => {
  test("capacitance in pF", () => {
    assert.equal(parseCapacitance("100nF"), 100000);
    assert.equal(parseCapacitance("0.1 µF"), 100000);
    assert.equal(parseCapacitance("100 pF"), 100);
    assert.equal(parseCapacitance("MLCC - SMD/SMT 0603 10uF 10volts X5R"), 10000000);
    assert.equal(parseCapacitance(""), null);
  });
  test("voltage, case, dielectric, tolerance", () => {
    assert.equal(parseVoltage("50 VDC"), 50);
    assert.equal(parseVoltage("0603 0.1uF 50volts X7R"), 50);
    assert.equal(parseCase("0603 (1608 Metric)"), "0603");
    assert.equal(parseCase("1005 (0402 Metric)"), null, "a metric code isn’t read as imperial");
    assert.equal(parseDielectric("C0G, NP0"), "C0G");
    assert.equal(parseDielectric("X7R"), "X7R");
    assert.equal(parseDielectric("X6S"), "X6S");
    assert.equal(parseTolerance("±10%"), 10);
    assert.equal(parseTolerance("+80%, -20%"), 80);
    assert.equal(parseTolerance("±0.25pF"), null);
  });
  test("lifecycle and grade", () => {
    assert.equal(parseLifecycle("Production"), "Active");
    assert.equal(parseLifecycle("Not Recommended for New Designs"), "NRND");
    assert.equal(parseLifecycle("Obsolete"), "EOL");
    assert.equal(parseLifecycle(""), null);
    assert.equal(parseGrade("AEC-Q200"), "automotive");
    assert.equal(parseGrade(null, "General purpose"), "commercial");
  });
  test("a Nexar part maps to the rules shape", () => {
    const p = fromNexar(normalizeNexarResults(NEXAR, "TEST-1").parts[0]);
    assert.deepEqual([p.pn, p.cap, p.v, p.pkg, p.diel, p.tol, p.grade, p.life], ["TEST-1", 100000, 50, "0603", "X7R", 10, "commercial", "Active"]);
    assert.equal(p.stock, 304000, "authorised stock across distributors");
    assert.equal(p.lead, 10, "shortest quoted lead time");
  });
  test("Mouser results merge by MPN and read specs from the description", () => {
    const base = {mpn: "TEST-2", manufacturer: "Test Mfr", lifecycle: null, priceBreaks: [], leadWeeks: 12,
      description: "Multilayer Ceramic Capacitors MLCC - SMD/SMT 0603 0.1uF 50volts X7R 10% AEC-Q200"};
    const [p, ...rest] = fromMouser([{...base, distributorPn: "1", stock: 5000, packaging: "Reel"},
                                     {...base, distributorPn: "2", stock: 5000, packaging: "Cut Tape"}]);
    assert.equal(rest.length, 0);
    assert.deepEqual([p.cap, p.v, p.pkg, p.diel, p.tol, p.grade, p.stock, p.offers.length], [100000, 50, "0603", "X7R", 10, "automotive", 5000, 2]);
  });
  test("retains a Mouser-recommended alternate from a localized listing description", () => {
    const [p] = fromMouser([{mpn:"ORIGINAL", description:"Capacitores cerámicos RECOMMENDED ALT 81-GRM188R72A104KA35", priceBreaks:[]}]);
    assert.equal(p.recommendedAlt, "81-GRM188R72A104KA35");
  });
  test("alternates query", () => {
    assert.equal(alternatesQuery({cap: 100000, pkg: "0603", diel: "X7R"}), "100nF 0603 X7R ceramic capacitor");
    assert.equal(alternatesQuery({cap: 10000000, pkg: "0805", diel: null}, false), "10uF 0805");
  });
});

describe("Worker source order", () => {
  const nexarOk = () => (async (url) => {
    if (url.includes("identity")) return {ok: true, json: async () => ({access_token: "t", expires_in: 3600})};
    return {ok: true, json: async () => ({errors: [{message: "Monthly part limit exceeded"}]})};
  });
  beforeEach(() => resetNexarToken());

  test("falls back to Mouser when the Nexar quota is used up", async () => {
    const mouserJson = {Errors: [], SearchResults: {Parts: [{
      ManufacturerPartNumber: "TEST-3", Manufacturer: "Test Mfr", AvailabilityInStock: "100", LeadTime: "70 Days",
      Description: "MLCC - SMD/SMT 0603 0.1uF 50volts X7R 10%", PriceBreaks: []}]}};
    const realFetch = globalThis.fetch;
    const nexar = nexarOk();
    globalThis.fetch = async (url, init) => url.includes("mouser") ? {ok: true, json: async () => mouserJson} : nexar(url, init);
    try {
      const env = {NEXAR_CLIENT_ID: "id", NEXAR_CLIENT_SECRET: "s", MOUSER_API_KEY: "k"};
      const r = await lookUp("TEST-3", env, {waitUntil(){}});
      assert.equal(r.source, "Mouser");
      assert.equal(r.errors.quota, true);
      assert.match(r.errors.Nexar, /quota/);
      assert.deepEqual([r.part.pn, r.part.cap, r.part.lead], ["TEST-3", 100000, 10]);
      assert.ok(r.fetchedAt);
    } finally { globalThis.fetch = realFetch; }
  });
  test("searches alternates on Mouser when Nexar’s alternates search fails", async () => {
    const part = {mpn: "TEST-5", manufacturer: {name: "M"}, specs: Object.entries(SPECS).map(([name, displayValue]) => ({attribute: {name}, displayValue})), sellers: []};
    const mouserJson = {Errors: [], SearchResults: {Parts: [
      {ManufacturerPartNumber: "TEST-6", Manufacturer: "Other", Description: "MLCC - SMD/SMT 0603 0.1uF 50volts X7R 10%", PriceBreaks: []},
      {ManufacturerPartNumber: "TEST-7", Manufacturer: "Other", Description: "MLCC - SMD/SMT 0805 0.1uF 50volts X7R 10%", PriceBreaks: []}]}};
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      if (url.includes("mouser")) return {ok: true, json: async () => mouserJson};
      if (url.includes("identity")) return {ok: true, json: async () => ({access_token: "t", expires_in: 3600})};
      const isMpn = JSON.parse(init.body).query.includes("supSearchMpn");
      return {ok: true, json: async () => isMpn
        ? {data: {supSearchMpn: {results: [{part}]}}}
        : {errors: [{message: "Monthly part limit exceeded"}]}};
    };
    try {
      const r = await lookUp("TEST-5", {NEXAR_CLIENT_ID: "id", NEXAR_CLIENT_SECRET: "s", MOUSER_API_KEY: "k"}, {waitUntil(){}});
      assert.equal(r.source, "Nexar");
      assert.equal(r.alternatesSource, "Mouser");
      assert.equal(r.alternatesError, null);
      assert.deepEqual(r.candidates.map(c => c.pn), ["TEST-6"], "same case only");
      assert.equal(r.errors.NexarAlternatesDetail, "Monthly part limit exceeded", "keeps Nexar’s own words");
    } finally { globalThis.fetch = realFetch; }
  });
  test("says so when no source is configured", async () => {
    const r = await lookUp("TEST-4", {}, {waitUntil(){}});
    assert.equal(r.source, null);
    assert.deepEqual(Object.keys(r.errors), ["Nexar", "Mouser"]);
  });

  test("keeps a Nexar plan result limit separate from monthly quota exhaustion", async () => {
    resetNexarToken();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async url => url.includes("identity")
      ? {ok:true, json:async () => ({access_token:"t", expires_in:3600})}
      : {ok:true, json:async () => ({errors:[{message:"You have exceeded your part limit of 10. Please upgrade your plan."}]})};
    try {
      const r = await lookUp("TEST-PLAN", {NEXAR_CLIENT_ID:"id", NEXAR_CLIENT_SECRET:"s"}, {waitUntil(){}});
      assert.equal(r.errors.planLimit, true);
      assert.equal(r.errors.quota, undefined);
      assert.match(r.errors.Nexar, /plan limits/);
    } finally {
      globalThis.fetch = realFetch;
      resetNexarToken();
    }
  });
});

describe("live parts in the rules", () => {
  const offers = [
    {stock: 2000, moq: 1, multiple: 1, priceBreaks: [{qty: 1, price: 0.1, currency: "USD"}, {qty: 1000, price: 0.01, currency: "USD"}]},
    {stock: 500000, moq: 4000, multiple: 4000, priceBreaks: [{qty: 4000, price: 0.004, currency: "USD"}]}
  ];
  test("best offer covers the order quantity first, then the lowest price", () => {
    assert.equal(bestOffer(offers, 1500).unit, 0.01, "a 4,000 reel is cheaper per piece but costs more in total");
    assert.equal(bestOffer(offers, 10000).unit, 0.004);
    assert.equal(bestOffer(offers, 10000).orderQty, 12000);
    assert.equal(bestOffer(offers, null).unit, 0.1, "without a quantity, each offer is priced at its MOQ");
    assert.equal(bestOffer([{stock: 1, priceBreaks: [{qty: 1, price: 1, currency: "EUR"}]}], 1), null);
  });
  test("missing price stays missing", () => {
    assert.equal(priceLive({offers: []}, 100).usd, null);
  });
  test("rank checks live candidates and counts the ones it can’t check", () => {
    const o = {fromPart: true, pn: "ORIG", mfr: "Test Mfr", cap: 100000, v: 50, pkg: "0603", diel: "X7R", tol: 10,
               grade: "commercial", stock: 0, lead: null, usd: null};
    const live = [
      {pn: "ALT-1", mfr: "Other", cap: 100000, v: 50, pkg: "0603", diel: "X7R", tol: 10, grade: "commercial", life: "Active", stock: null, lead: null, usd: null},
      {pn: "ALT-2", mfr: "Other", cap: 100000, v: 50, pkg: "0603", diel: "X7R", tol: null, grade: "commercial", stock: 10, lead: 3, usd: 0.01},
      {pn: "ALT-3", mfr: "Other", cap: 100000, v: null, pkg: "0603", diel: "X7R", tol: 10, grade: "commercial", stock: 10, lead: 3, usd: 0.01},
      {pn: "ALT-4", mfr: "Other", cap: 100000, v: 50, pkg: "0603", diel: "X6S", tol: 10, grade: "commercial", stock: 10, lead: 3, usd: 0.01}
    ];
    assert.ok(!isCheckable(live[2]) && !isCheckable(live[3]));
    const r = rank(o, {mode: "equivalent", required: "commercial", candidates: live, demand: {qty: 100, today: new Date(2026, 10, 2)}});
    assert.equal(r.unchecked, 2);
    assert.deepEqual(r.fits.map(f => f.part.pn).sort(), ["ALT-1", "ALT-2"]);
    const alt1 = r.fits.find(f => f.part.pn === "ALT-1");
    assert.equal(alt1.plan.usableDate, null, "no stock or lead time: usable date unknown, not guessed");
    assert.equal(alt1.cost.unit, null);
    assert.equal(r.fits.find(f => f.part.pn === "ALT-2").verdict, "warn", "missing tolerance needs review");
  });
});

describe("Worker request limits", () => {
  test("rejects a request when the caller is over the configured rate limit", async () => {
    let key;
    const request = new Request("https://worker.test/part?mpn=GRM188R71H104KA93D", {
      headers: {Origin: "https://andreevazquez.github.io", "CF-Connecting-IP": "203.0.113.7"}
    });
    const response = await worker.fetch(request, {
      ALLOWED_ORIGIN: "https://andreevazquez.github.io",
      MLCC_LIMITER: {limit: async ({key: k}) => { key = k; return {success: false}; }}
    }, {});
    assert.equal(response.status, 429);
    assert.equal(key, "203.0.113.7");
    assert.equal(response.headers.get("Retry-After"), "60");
  });

  test("fails closed if rate limiting is not configured", async () => {
    const request = new Request("https://worker.test/part?mpn=GRM188R71H104KA93D", {
      headers: {"CF-Connecting-IP": "203.0.113.8"}
    });
    const response = await worker.fetch(request, {}, {});
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /protection is unavailable/);
  });
});
