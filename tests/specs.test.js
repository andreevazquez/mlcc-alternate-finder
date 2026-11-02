import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {parseCapacitance, parseVoltage, parseCase, parseDielectric, parseTolerance,
        parseLifecycle, parseGrade} from "../worker/src/specs.js";

describe("spec parsing", () => {
  test("capacitance in any unit becomes picofarads", () => {
    assert.equal(parseCapacitance("100 nF"), 100000);
    assert.equal(parseCapacitance("0.1µF"), 100000);
    assert.equal(parseCapacitance("10uF"), 10000000);
    assert.equal(parseCapacitance("100pF"), 100);
    assert.equal(parseCapacitance("1e-07", "F"), 100000);
    assert.equal(parseCapacitance("1e-07"), null, "a bare number without units is not guessed");
    assert.equal(parseCapacitance(""), null);
  });
  test("voltage", () => {
    assert.equal(parseVoltage("50 VDC"), 50);
    assert.equal(parseVoltage("6.3V"), 6.3);
    assert.equal(parseVoltage("1kV"), 1000);
    assert.equal(parseVoltage(null), null);
  });
  test("case size: imperial codes only", () => {
    assert.equal(parseCase("0603 (1608 Metric)"), "0603");
    assert.equal(parseCase("0402"), "0402");
    assert.equal(parseCase("0603 Metric"), null, "metric 0603 is imperial 0201, not 0603");
    assert.equal(parseCase("Radial"), null);
  });
  test("dielectric", () => {
    for (const s of ["C0G", "NP0", "C0G, NP0", "cog"]) assert.equal(parseDielectric(s), "C0G");
    assert.equal(parseDielectric("X7R"), "X7R");
    assert.equal(parseDielectric("X6S"), "X6S");
    assert.equal(parseDielectric("Tantalum"), null);
  });
  test("tolerance as a percentage, worst case for asymmetric ranges", () => {
    assert.equal(parseTolerance("±10%"), 10);
    assert.equal(parseTolerance("+80%, -20%"), 80);
    assert.equal(parseTolerance("±0.25pF"), null);
  });
  test("lifecycle wording maps to Active, NRND or EOL, else stays unknown", () => {
    assert.equal(parseLifecycle("Production"), "Active");
    assert.equal(parseLifecycle("Not Recommended for New Designs"), "NRND");
    assert.equal(parseLifecycle("Obsolete"), "EOL");
    assert.equal(parseLifecycle("Unknown"), null);
    assert.equal(parseLifecycle(""), null);
  });
  test("grade: AEC-Q200 means automotive; medical is never inferred", () => {
    assert.equal(parseGrade("AEC-Q200"), "automotive");
    assert.equal(parseGrade(null, "CAP CER 0.1UF 50V X7R 0603 AECQ200"), "automotive");
    assert.equal(parseGrade("Medical", "medical grade"), "commercial");
  });
});
