import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
  mouserRequest, mouserKeywordRequest, alternatesKeyword, parsePrice, parseLeadTime,
  normalizeMouserResponse, normalizeMouserKeyword
} from "../worker/src/mouser.js";

// A hand-written response in the documented shape, to test the parsing only.
// The values are invented for the test and are never shown on the page.
const part = (mpn, extra = {}) => ({
  ManufacturerPartNumber: mpn, MouserPartNumber: `000-${mpn}`, Manufacturer: "Test Mfr",
  Description: "Test capacitor", AvailabilityInStock: "12000", LeadTime: "26 Weeks", Min: "1", Mult: "1",
  LifecycleStatus: "", DataSheetUrl: "https://example.com/ds.pdf", ProductDetailUrl: "https://example.com/p",
  ProductAttributes: [
    {AttributeName: "Packaging", AttributeValue: "Cut Tape"},
    {AttributeName: "Capacitance", AttributeValue: "100 nF"},
    {AttributeName: "Voltage Rating DC", AttributeValue: "50 VDC"},
    {AttributeName: "Case Code - in", AttributeValue: "0603"},
    {AttributeName: "Dielectric", AttributeValue: "X7R"},
    {AttributeName: "Tolerance", AttributeValue: "10 %"}
  ],
  PriceBreaks: [
    {Quantity: 100, Price: "$0.020", Currency: "USD"},
    {Quantity: 1, Price: "$0.10", Currency: "USD"},
    {Quantity: 4000, Price: "$0.004", Currency: "USD"},
    {Quantity: 1, Price: "0,09 €", Currency: "EUR"}
  ],
  ...extra
});
const FIXTURE = {
  Errors: [],
  SearchResults: {
    NumberOfResult: 3,
    Parts: [
      part("TEST-PART-1"),
      part("TEST-PART-1", {MouserPartNumber: "000-TEST-PART-1-R", Min: "4000", Mult: "4000", AvailabilityInStock: "8000",
        ProductAttributes: [{AttributeName: "Packaging", AttributeValue: "Reel"}], PriceBreaks: [{Quantity: 4000, Price: "$0.003", Currency: "USD"}]}),
      part("TEST-PART-1X")
    ]
  }
};

describe("Mouser adapter", () => {
  test("builds an exact part-number search request", () => {
    const {url, init} = mouserRequest("GRM188R71H104KA93D", "k e y");
    assert.ok(url.endsWith("/search/partnumber?apiKey=k%20e%20y"));
    assert.equal(init.method, "POST");
    assert.deepEqual(JSON.parse(init.body),
      {SearchByPartRequest: {mouserPartNumber: "GRM188R71H104KA93D", partSearchOptions: "Exact"}});
  });
  test("builds a keyword search for alternates with the same capacitance and case", () => {
    assert.equal(alternatesKeyword({cap: 100000, pkg: "0603"}), "100nF 0603 ceramic capacitor");
    assert.equal(alternatesKeyword({cap: 100, pkg: "0402"}), "100pF 0402 ceramic capacitor");
    assert.equal(alternatesKeyword({cap: 100000, pkg: null}), null);
    const {url, init} = mouserKeywordRequest("100nF 0603 ceramic capacitor", "k");
    assert.ok(url.includes("/search/keyword?"));
    assert.equal(JSON.parse(init.body).SearchByKeywordRequest.keyword, "100nF 0603 ceramic capacitor");
  });
  test("parses prices and lead times", () => {
    assert.equal(parsePrice("$0.10"), 0.1);
    assert.equal(parsePrice("1,234.50"), 1234.5);
    assert.equal(parsePrice(""), null);
    assert.equal(parseLeadTime("26 Weeks"), 26);
    assert.equal(parseLeadTime("10 Days"), 2);
    assert.equal(parseLeadTime(""), null);
  });
  test("keeps exact matches only and merges packagings into offers of one part", () => {
    const {part: p} = normalizeMouserResponse(FIXTURE, "test-part-1");
    assert.equal(p.pn, "TEST-PART-1");
    assert.deepEqual([p.cap, p.v, p.pkg, p.diel, p.tol, p.grade, p.life], [100000, 50, "0603", "X7R", 10, "commercial", null]);
    assert.equal(p.offers.length, 2);
    const [cut, reel] = p.offers;
    assert.deepEqual([cut.distributor, cut.stock, cut.leadWeeks, cut.moq, cut.multiple, cut.packaging], ["Mouser", 12000, 26, 1, 1, "Cut Tape"]);
    assert.deepEqual(cut.priceBreaks.map(b => b.qty), [1, 100, 4000], "USD only, sorted");
    assert.deepEqual([reel.moq, reel.multiple, reel.packaging], [4000, 4000, "Reel"]);
  });
  test("a part Mouser doesn’t list comes back empty, not invented", () => {
    assert.equal(normalizeMouserResponse(FIXTURE, "NOPE-123").part, null);
  });
  test("keyword results become parts", () => {
    const {parts} = normalizeMouserKeyword(FIXTURE);
    assert.deepEqual(parts.map(p => p.pn), ["TEST-PART-1", "TEST-PART-1X"]);
  });
  test("passes API errors through", () => {
    assert.deepEqual(normalizeMouserResponse({Errors: [{Message: "Invalid key"}]}, "X"), {error: "Invalid key"});
  });
});
