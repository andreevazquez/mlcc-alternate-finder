import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {parseRates} from "../js/fx.js";
import {fxRates} from "../worker/src/index.js";

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

describe("Worker /fx", () => {
  test("returns validated rates with their source", async () => {
    const fx = await fxRates({}, async () => ({ok: true, json: async () => SAMPLE}));
    assert.deepEqual(fx.perUsd, {USD: 1, MXN: 18.5905, EUR: 0.89095});
    assert.match(fx.source, /European Central Bank/);
  });
  test("an implausible answer becomes an error, never a rate", async () => {
    const fx = await fxRates({}, async () => ({ok: true, json: async () => ({...SAMPLE, rates: {EUR: 0}})}));
    assert.ok(fx.error);
    assert.equal(fx.perUsd, undefined);
  });
});
