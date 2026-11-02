import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {unitPriceAt, orderQuantity, quote, toRulesPart, fromWorker, ageText, sourceLabel} from "../live.js";
import {rank} from "../rules.js";

// Invented live parts in the Worker's shape, for the tests only.
const offer = (o = {}) => ({distributor: "Dist A", sku: "A", stock: 0, moq: 1, multiple: 1, packaging: "Cut Tape",
  leadWeeks: null, priceBreaks: [], url: null, ...o});
const livePart = (pn, o = {}) => ({pn, mfr: "Test Mfr", cap: 100000, v: 50, pkg: "0603", diel: "X7R", tol: 10,
  grade: "commercial", life: "Active", datasheet: null, offers: [], ...o});

describe("pricing at the order quantity", () => {
  test("unit price is the highest break at or below the quantity", () => {
    const breaks = [{qty: 1, price: 0.1}, {qty: 100, price: 0.02}, {qty: 4000, price: 0.004}];
    assert.equal(unitPriceAt(breaks, 50), 0.1);
    assert.equal(unitPriceAt(breaks, 4000), 0.004);
    assert.equal(unitPriceAt(breaks, 250000), 0.004);
    assert.equal(unitPriceAt([{qty: 10, price: 1}], 5), null);
  });
  test("order quantity respects MOQ and multiples", () => {
    assert.equal(orderQuantity(250000, {moq: 4000, multiple: 4000}), 252000);
    assert.equal(orderQuantity(100, {moq: 4000, multiple: 4000}), 4000);
    assert.equal(orderQuantity(10, {moq: 1, multiple: 1}), 10);
    assert.equal(orderQuantity(null, {moq: 4000}), 4000, "no quantity: price at the MOQ");
  });
  test("a reel MOQ prices at the reel break, not the cut-tape one", () => {
    const reel = offer({moq: 4000, multiple: 4000, priceBreaks: [{qty: 4000, price: 0.003}]});
    assert.deepEqual(quote(reel, 100), {orderQty: 4000, unit: 0.003, total: 12});
  });
});

describe("live part -> rules part", () => {
  const p = livePart("TEST-1", {offers: [
    offer({distributor: "A", stock: 3000, leadWeeks: 12, priceBreaks: [{qty: 1, price: 0.1}, {qty: 1000, price: 0.02}]}),
    offer({distributor: "B", stock: 8000, moq: 4000, multiple: 4000, packaging: "Reel", leadWeeks: 8, priceBreaks: [{qty: 4000, price: 0.004}]}),
    offer({distributor: "C", stock: null, leadWeeks: null})
  ]});
  test("stock adds up, lead is the shortest listed, price is the cheapest at the order quantity", () => {
    const r = toRulesPart(p, {qty: 250000});
    assert.equal(r.stock, 11000);
    assert.equal(r.lead, 8);
    assert.equal(r.usd, 0.004);
    assert.equal(r.best.distributor, "B");
    assert.equal(r.best.quote.orderQty, 252000);
  });
  test("small quantity: the cut-tape offer wins on what you’d actually pay", () => {
    const r = toRulesPart(p, {qty: 10});
    assert.equal(r.best.distributor, "A");
    assert.equal(r.usd, 0.1);
  });
  test("nothing listed stays empty", () => {
    const r = toRulesPart(livePart("TEST-2", {offers: [offer({stock: null})]}));
    assert.deepEqual([r.stock, r.lead, r.usd, r.best], [null, null, null, null]);
  });
});

describe("worker answer -> ranking", () => {
  const body = {
    mpn: "TEST-1", fetchedAt: "2026-11-02T10:00:00Z", source: "Nexar", notices: [], errors: {},
    part: livePart("TEST-1", {offers: [offer({stock: 0, leadWeeks: 20, priceBreaks: [{qty: 1, price: 0.01}]})]}),
    alternates: [
      livePart("TEST-ALT-SAME", {offers: [offer({stock: 500000, priceBreaks: [{qty: 1, price: 0.008}]})]}),
      livePart("TEST-ALT-NOV", {v: null, diel: "X7S", offers: [offer({stock: 1000, leadWeeks: 6})]}),
      livePart("TEST-ALT-0402", {pkg: "0402", offers: [offer({stock: 1})]}),
      livePart("TEST-ALT-10UF", {cap: 10000000}),
      livePart("TEST-1")
    ]
  };
  test("ranks live alternates with the same rules", () => {
    const {spec, pool, source} = fromWorker(body, {qty: 250000});
    assert.equal(source, "Nexar");
    assert.ok(spec.live && spec.fromPart);
    const r = rank(spec, {mode: "equivalent", required: "commercial", pool,
      demand: {qty: 250000, today: new Date(2026, 10, 2)}});
    assert.deepEqual(r.fits.map(x => x.part.pn), ["TEST-ALT-SAME", "TEST-ALT-NOV"]);
    assert.deepEqual(r.ruledOut.map(x => x.part.pn), ["TEST-ALT-0402"]);
    const nov = r.fits[1];
    assert.equal(nov.verdict, "warn");
    assert.ok(nov.checks.some(k => /Rated voltage not listed/.test(k.text)));
    assert.ok(nov.checks.some(k => /X7S instead of X7R/.test(k.text)));
    assert.ok(nov.checks.some(k => k.key === "temp" && /−55 to 125 °C/.test(k.text)), "EIA code gives the range");
    assert.equal(nov.cost.unit, null, "no price listed: no cost, nothing invented");
    assert.equal(r.fits[0].cost.unit, 0.008);
  });
  test("unknown lead time with no stock leaves the date unknown", () => {
    const {spec, pool} = fromWorker({...body, alternates: [livePart("TEST-ALT-X", {offers: [offer({stock: 0})]})]});
    const r = rank(spec, {mode: "equivalent", required: "commercial", pool, demand: {today: new Date(2026, 10, 2)}});
    assert.equal(r.fits[0].plan.usableDate, null);
  });
  test("no part: errors come through", () => {
    assert.equal(fromWorker({part: null, errors: {nexar: "down", mouser: "down too"}}).error, "down; down too");
    assert.equal(fromWorker({part: null, errors: {}}).error, "notfound");
  });
});

describe("source and time", () => {
  const now = new Date("2026-11-02T12:00:00Z");
  test("age reads naturally", () => {
    assert.equal(ageText("2026-11-02T11:59:50Z", now), "just now");
    assert.equal(ageText("2026-11-02T11:48:00Z", now), "12 min ago");
    assert.equal(ageText("2026-11-02T10:00:00Z", now), "2 h ago");
    assert.equal(ageText("2026-10-30T12:00:00Z", now), "3 days ago");
  });
  test("label", () => {
    assert.equal(sourceLabel({source: "Mouser", fetchedAt: "2026-11-02T10:00:00Z"}, now), "Mouser · 2 h ago");
  });
});
