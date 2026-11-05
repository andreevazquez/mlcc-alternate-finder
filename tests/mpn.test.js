import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {decodeMpn, eiaCap, fillFromMpn} from "../worker/src/mpn.js";
import {fromMouser} from "../worker/src/parts.js";

const specs = d => d && [d.cap, d.v, d.pkg, d.diel, d.tol];

describe("part-number decoding", () => {
  test("EIA capacitance codes", () => {
    assert.equal(eiaCap("104"), 100000);
    assert.equal(eiaCap("475"), 4700000);
    assert.equal(eiaCap("1R0"), 1);
    assert.equal(eiaCap("R50"), 0.5);
    assert.equal(eiaCap("10"), null);
    assert.equal(eiaCap("ABC"), null);
  });
  test("Murata", () => {
    assert.deepEqual(specs(decodeMpn("GRM188R71H104KA93D")), [100000, 50, "0603", "X7R", 10]);
    assert.deepEqual(specs(decodeMpn("GRM188R72A104KA35D")), [100000, 100, "0603", "X7R", 10]);
    assert.deepEqual(specs(decodeMpn("GCM1555C1H101JA16D")), [100, 50, "0402", "C0G", 5]);
    assert.deepEqual(specs(decodeMpn("grm21br61a106ke19l")), [10000000, 10, "0805", "X5R", 10]);
  });
  test("Samsung", () => {
    assert.deepEqual(specs(decodeMpn("CL10B104KB8NNNC")), [100000, 50, "0603", "X7R", 10]);
    assert.deepEqual(specs(decodeMpn("CL21A106KOQNNNE")), [10000000, 16, "0805", "X5R", 10]);
  });
  test("TDK", () => {
    assert.deepEqual(specs(decodeMpn("C1608X7R1H104K080AA")), [100000, 50, "0603", "X7R", 10]);
    assert.deepEqual(specs(decodeMpn("C1005C0G1H101J050BA")), [100, 50, "0402", "C0G", 5]);
  });
  test("KEMET", () => {
    assert.deepEqual(specs(decodeMpn("C0603C104K5RACTU")), [100000, 50, "0603", "X7R", 10]);
    assert.deepEqual(specs(decodeMpn("C0805C106K8PACTU")), [10000000, 10, "0805", "X5R", 10]);
  });
  test("Yageo", () => {
    assert.deepEqual(specs(decodeMpn("CC0603KRX7R9BB104")), [100000, 50, "0603", "X7R", 10]);
    assert.deepEqual(specs(decodeMpn("CC0402JRNPO9BN101")), null); // BN isn't the BB format: not guessed
  });
  test("unknown formats and absolute tolerances stay null", () => {
    assert.equal(decodeMpn("885012206095"), null);
    assert.equal(decodeMpn("LM358"), null);
    assert.equal(decodeMpn(""), null);
    assert.equal(decodeMpn("GRM1555C1H1R0CA01D").tol, null); // C = ±0.25 pF
  });
});

describe("filling a listing from its part number", () => {
  test("the listing's own value wins; only gaps are filled", () => {
    const p = fillFromMpn({pn: "GRM188R71H104KA93D", cap: null, v: 25, pkg: null, diel: null, tol: null});
    assert.deepEqual(specs(p), [100000, 25, "0603", "X7R", 10]);
    assert.deepEqual(p.decoded, ["cap", "pkg", "diel", "tol"]);
  });
  test("a Mouser listing with only RECOMMENDED ALT gets its specs from the part number", () => {
    const [p] = fromMouser([{mpn: "GRM188R71H104KA93D", manufacturer: "Murata", priceBreaks: [],
      description: "Capacitores cerámicos de capas múltiples (MLCC) - SMD/SMT RECOMMENDED ALT 81-GRM188R72A104KA35"}]);
    assert.deepEqual(specs(p), [100000, 50, "0603", "X7R", 10]);
    assert.equal(p.recommendedAlt, "81-GRM188R72A104KA35");
    assert.equal(p.decoded.length, 5);
  });
  test("a complete description decodes nothing", () => {
    const [p] = fromMouser([{mpn: "CL10B104KB8NNNC", priceBreaks: [], description: "MLCC - SMD/SMT 100nF+/-10% 50V X7R 0603"}]);
    assert.deepEqual(p.decoded, []);
  });
});
