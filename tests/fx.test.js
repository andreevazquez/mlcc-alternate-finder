import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {parseRates, convert, crossRates, CURRENCIES} from "../fx.js";

// A real Frankfurter answer, 2026-11-05.
const SAMPLE = {amount: 1.0, base: "USD", date: "2026-11-05", rates: {EUR: 0.89095, MXN: 18.5905}};
const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);

describe("parseRates", () => {
  test("reads a Frankfurter answer", () => {
    assert.deepEqual(parseRates(SAMPLE), {date: "2026-11-05", perUsd: {USD: 1, MXN: 18.5905, EUR: 0.89095}});
  });
  test("divides by amount when it isn't 1", () => {
    near(parseRates({...SAMPLE, amount: 10, rates: {EUR: 8.9095, MXN: 185.905}}).perUsd.MXN, 18.5905);
  });
  test("rejects anything missing or implausible instead of guessing", () => {
    for (const bad of [null, {}, "x", {...SAMPLE, base: "EUR"}, {...SAMPLE, date: "yesterday"}, {...SAMPLE, rates: null},
      {...SAMPLE, rates: {EUR: 0.89}}, {...SAMPLE, rates: {EUR: 0.89, MXN: 0}}, {...SAMPLE, rates: {EUR: -1, MXN: 18}},
      {...SAMPLE, rates: {EUR: "0.89", MXN: "x"}}, {...SAMPLE, amount: 0}])
      assert.equal(parseRates(bad), null, JSON.stringify(bad));
  });
});

describe("convert", () => {
  const {perUsd} = parseRates(SAMPLE);
  test("USD to MXN and EUR", () => {
    near(convert(100, "USD", "MXN", perUsd), 1859.05);
    near(convert(100, "USD", "EUR", perUsd), 89.095);
  });
  test("cross rate EUR to MXN goes through USD", () => {
    near(convert(1, "EUR", "MXN", perUsd), 18.5905 / 0.89095);
  });
  test("round trip returns the amount", () => {
    near(convert(convert(1234.56, "MXN", "EUR", perUsd), "EUR", "MXN", perUsd), 1234.56, 1e-6);
  });
  test("unknown currency or no rates gives null", () => {
    assert.equal(convert(1, "USD", "JPY", perUsd), null);
    assert.equal(convert(1, "USD", "MXN", null), null);
    assert.equal(convert(NaN, "USD", "MXN", perUsd), null);
  });
});

test("crossRates lists every pair once", () => {
  const list = crossRates(parseRates(SAMPLE).perUsd);
  const n = Object.keys(CURRENCIES).length;
  assert.equal(list.length, n * (n - 1));
  assert.ok(list.every(x => x.from !== x.to && x.rate > 0));
});
