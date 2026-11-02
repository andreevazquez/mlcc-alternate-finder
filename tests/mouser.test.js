import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
  mouserRequest, parsePrice, parseLeadTime, normalizeMouserResponse, unitPriceAt, orderQuantity
} from "../worker/src/mouser.js";

// A hand-written response in the documented shape, to test the parsing only.
// The values are invented for the test and are never shown on the page.
const FIXTURE = {
  Errors: [],
  SearchResults: {
    NumberOfResult: 2,
    Parts: [
      {
        ManufacturerPartNumber: "TEST-PART-1", MouserPartNumber: "000-TEST-PART-1", Manufacturer: "Test Mfr",
        Description: "Test capacitor", AvailabilityInStock: "12000", LeadTime: "26 Weeks", Min: "1", Mult: "1",
        LifecycleStatus: "", DataSheetUrl: "https://example.com/ds.pdf", ProductDetailUrl: "https://example.com/p",
        ProductAttributes: [{AttributeName: "Packaging", AttributeValue: "Cut Tape"}],
        PriceBreaks: [
          {Quantity: 100, Price: "$0.020", Currency: "USD"},
          {Quantity: 1, Price: "$0.10", Currency: "USD"},
          {Quantity: 4000, Price: "$0.004", Currency: "USD"}
        ]
      },
      {ManufacturerPartNumber: "TEST-PART-1X", Manufacturer: "Test Mfr"}
    ]
  }
};

describe("Mouser adapter", () => {
  test("builds an exact part-number search request", () => {
    const {url, init} = mouserRequest("GRM188R71H104KA93D", "k e y");
    assert.ok(url.endsWith("?apiKey=k%20e%20y"));
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body),
      {SearchByPartRequest: {mouserPartNumber: "GRM188R71H104KA93D", partSearchOptions: "Exact"}});
  });
  test("parses prices and lead times", () => {
    assert.equal(parsePrice("$0.10"), 0.1);
    assert.equal(parsePrice("1,234.50"), 1234.5);
    assert.equal(parsePrice(""), null);
    assert.equal(parseLeadTime("26 Weeks"), 26);
    assert.equal(parseLeadTime("10 Days"), 2);
    assert.equal(parseLeadTime(""), null);
  });
  test("keeps exact matches only and normalises fields", () => {
    const {parts} = normalizeMouserResponse(FIXTURE, "test-part-1");
    assert.equal(parts.length, 1);
    const p = parts[0];
    assert.deepEqual([p.stock, p.leadWeeks, p.moq, p.multiple, p.packaging, p.lifecycle], [12000, 26, 1, 1, "Cut Tape", null]);
    assert.deepEqual(p.priceBreaks.map(b => b.qty), [1, 100, 4000]);
  });
  test("passes API errors through", () => {
    assert.deepEqual(normalizeMouserResponse({Errors: [{Message: "Invalid key"}]}, "X"), {error: "Invalid key"});
  });
  test("unit price is the highest break at or below the quantity", () => {
    const breaks = [{qty: 1, price: 0.1}, {qty: 100, price: 0.02}, {qty: 4000, price: 0.004}];
    assert.equal(unitPriceAt(breaks, 50), 0.1);
    assert.equal(unitPriceAt(breaks, 4000), 0.004);
    assert.equal(unitPriceAt(breaks, 250000), 0.004);
  });
  test("order quantity respects MOQ and multiples", () => {
    assert.equal(orderQuantity(250000, {moq: 4000, multiple: 4000}), 252000);
    assert.equal(orderQuantity(100, {moq: 4000, multiple: 4000}), 4000);
    assert.equal(orderQuantity(10, {moq: 1, multiple: 1}), 10);
  });
});
