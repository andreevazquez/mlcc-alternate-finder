import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {CATALOG, BY_PN, fmtCap, fmtTol, meetsGrade, parseQuery, evaluate, rank} from "../rules.js";

const spec = q => {
  const r = parseQuery(q);
  assert.ok(r.spec, `expected a spec for “${q}”, got error: ${r.error}`);
  return r.spec;
};
const errorOf = q => {
  const r = parseQuery(q);
  assert.ok(r.error, `expected an error for “${q}”`);
  return r.error;
};
const pns = results => results.map(r => r.part.pn);

describe("catalog", () => {
  test("has 30 unique part numbers", () => {
    assert.equal(CATALOG.length, 30);
    assert.equal(BY_PN.size, 30);
  });
  test("has no medical-grade parts", () => {
    assert.ok(CATALOG.every(p => p.grade !== "medical"));
  });
});

describe("part-number lookup", () => {
  test("exact match returns the catalog part", () => {
    const s = spec("GRM188R71H104KA93D");
    assert.equal(s.fromPart, true);
    assert.equal(s.mfr, "Murata");
    assert.equal(s.cap, 100000);
  });
  test("is case- and whitespace-insensitive", () => {
    assert.equal(spec("  grm188r71h104ka93d ").pn, "GRM188R71H104KA93D");
  });
  test("unique prefix of 8+ characters resolves", () => {
    assert.equal(spec("CL10F104").pn, "CL10F104ZB8NNNC");
  });
  test("ambiguous prefix asks the user to pick", () => {
    assert.match(errorOf("GRM188R7"), /matches 2 parts\. Pick one/);
  });
  test("unknown part number suggests describing it instead", () => {
    assert.match(errorOf("ABC12345XYZ"), /ABC12345XYZ isn’t in this demo catalog\. Describe it instead/);
  });
  test("empty input explains what to enter", () => {
    assert.match(errorOf("   "), /Enter a part number or a description/);
  });
});

describe("BOM description parsing", () => {
  test("CAP CER 10UF 10V X5R 0805", () => {
    const s = spec("CAP CER 10UF 10V X5R 0805");
    assert.equal(s.fromPart, false);
    assert.deepEqual([s.cap, s.v, s.diel, s.pkg, s.tol, s.grade], [10000000, 10, "X5R", "0805", null, "commercial"]);
  });
  test("100pF 50V C0G 0603 AEC-Q200", () => {
    const s = spec("100pF 50V C0G 0603 AEC-Q200");
    assert.deepEqual([s.cap, s.v, s.diel, s.pkg, s.grade], [100, 50, "C0G", "0603", "automotive"]);
  });
  test("1uF 0402 10V X5R (order doesn’t matter)", () => {
    const s = spec("1uF 0402 10V X5R");
    assert.deepEqual([s.cap, s.v, s.diel, s.pkg], [1000000, 10, "X5R", "0402"]);
  });
  test("100n 0603 (no F, missing fields left null)", () => {
    const s = spec("100n 0603");
    assert.deepEqual([s.cap, s.pkg, s.v, s.diel, s.tol], [100000, "0603", null, null, null]);
  });
  test("NP0 and COG normalise to C0G; tolerance and medical keyword are read", () => {
    assert.equal(spec("100pF NP0 0603").diel, "C0G");
    assert.equal(spec("100pF COG 0603").diel, "C0G");
    assert.equal(spec("0.1uF 10% 0603").tol, 10);
    assert.equal(spec("0.1uF 0603 medical").grade, "medical");
  });
  test("value not in the catalog (22uF) lists what is covered", () => {
    assert.equal(errorOf("22uF 10V X5R 0805"),
      "22 µF isn’t in this demo catalog. It covers 100 pF, 0.1 µF, 1 µF, 10 µF.");
  });
  test("description without a capacitance asks for one", () => {
    assert.match(errorOf("50V X7R 0603"), /Add a capacitance/);
  });
});

describe("formatting", () => {
  test("capacitance renders in the right unit", () => {
    assert.equal(fmtCap(10000000), "10 µF");
    assert.notEqual(fmtCap(10000000), "1 µF");
    assert.equal(fmtCap(1000000), "1 µF");
    assert.equal(fmtCap(100000), "0.1 µF");
    assert.equal(fmtCap(4700), "4.7 nF");
    assert.equal(fmtCap(100), "100 pF");
    assert.equal(fmtCap(null), "Not specified");
  });
  test("tolerance renders Y5V’s asymmetric range", () => {
    assert.equal(fmtTol(10), "±10%");
    assert.equal(fmtTol(80), "+80/−20%");
  });
});

describe("grade rules", () => {
  test("grades are not a ladder", () => {
    assert.equal(meetsGrade("automotive", "commercial"), true);
    assert.equal(meetsGrade("commercial", "automotive"), false);
    assert.equal(meetsGrade("automotive", "medical"), false);
    assert.equal(meetsGrade("commercial", "medical"), false);
    assert.equal(meetsGrade("medical", "medical"), true);
  });
  test("automotive part replaces a commercial one, flagged as an upgrade", () => {
    const o = BY_PN.get("GRM188R71H104KA93D");
    const r = evaluate(o, BY_PN.get("GCM188R71H104KA57D"), "commercial");
    assert.equal(r.verdict, "ok");
    assert.ok(r.upgrades.includes("AEC-Q200"));
  });
  test("automotive requirement rules out every commercial part", () => {
    const o = BY_PN.get("GRM188R71H104KA93D");
    const {fits} = rank(o, {mode:"equivalent", required:"automotive"});
    assert.deepEqual(pns(fits).sort(), ["CGA3E2X7R1H104K080AA", "GCM188R71H104KA57D"]);
  });
  test("nothing but medical grade replaces medical", () => {
    const o = spec("100pF 50V C0G 0603");
    const {fits, ruledOut} = rank(o, {mode:"equivalent", required:"medical"});
    assert.equal(fits.length, 0);
    assert.ok(ruledOut.length > 0);
    const auto = ruledOut.find(r => r.part.pn === "GCM1885C1H101JA16D");
    assert.ok(auto.fails.includes("Automotive (AEC-Q200), not released for medical use"));
  });
});

describe("other rules", () => {
  const o = BY_PN.get("GRM188R71H104KA93D");
  test("lower voltage, different case, dielectric downgrade and looser tolerance all fail", () => {
    assert.equal(evaluate(o, BY_PN.get("C1608X7R1E104K080AA"), "commercial").verdict, "bad"); // 25 V
    assert.equal(evaluate(o, BY_PN.get("CL21B104KBCNNNC"), "commercial").verdict, "bad");     // 0805
    assert.equal(evaluate(o, BY_PN.get("CL10F104ZB8NNNC"), "commercial").verdict, "bad");     // Y5V
  });
  test("higher voltage passes but needs review for part height", () => {
    const r = evaluate(o, BY_PN.get("GRM188R72A104KA35D"), "commercial");
    assert.equal(r.verdict, "warn");
    assert.ok(r.checks.some(k => /check part height/.test(k.text)));
  });
  test("new manufacturer is an info note that doesn’t change the verdict", () => {
    const r = evaluate(o, BY_PN.get("CL10B104KB8NNNC"), "commercial");
    assert.equal(r.verdict, "ok");
    assert.ok(r.checks.some(k => k.state === "info" && /approved-vendor-list/.test(k.text)));
  });
  test("the original part is never its own alternate", () => {
    const {fits, ruledOut} = rank(o, {mode:"equivalent", required:"commercial"});
    assert.ok(![...fits, ...ruledOut].some(r => r.part.pn === o.pn));
  });
});

describe("missing description fields", () => {
  test("are flagged for review, never silently passed", () => {
    const {fits} = rank(spec("100n 0603"), {mode:"equivalent", required:"commercial"});
    assert.ok(fits.length > 0);
    for (const r of fits){
      assert.equal(r.verdict, "warn", `${r.part.pn} should need review`);
      assert.ok(r.checks.some(k => k.state === "warn" && /you didn’t give a voltage/.test(k.text)));
      assert.ok(r.checks.some(k => k.state === "warn" && /you didn’t give one, confirm with engineering/.test(k.text)));
    }
  });
});

describe("ranking", () => {
  test("equivalent mode sorts by verdict, then lead time, then stock", () => {
    const {fits} = rank(BY_PN.get("GRM188R71H104KA93D"), {mode:"equivalent", required:"commercial"});
    const order = {ok:0, warn:1};
    for (let i = 1; i < fits.length; i++){
      const a = fits[i - 1], b = fits[i];
      const cmp = order[a.verdict] - order[b.verdict] || a.part.lead - b.part.lead || b.part.stock - a.part.stock;
      assert.ok(cmp <= 0, `${a.part.pn} should not rank above ${b.part.pn}`);
    }
    assert.equal(fits[0].part.pn, "CC0603KRX7R9BB104");
  });
  test("better-than mode excludes equivalents and ranks by number of upgrades", () => {
    const o = spec("CAP CER 10UF 10V X5R 0805");
    const eq = rank(o, {mode:"equivalent", required:"commercial"});
    const up = rank(o, {mode:"better", required:"commercial"});
    assert.ok(up.fits.every(r => r.upgrades.length > 0));
    assert.equal(up.equivalentOnly, 3);
    assert.equal(up.fits.length + up.equivalentOnly, eq.fits.length);
    for (let i = 1; i < up.fits.length; i++){
      assert.ok(up.fits[i - 1].upgrades.length >= up.fits[i].upgrades.length);
    }
    assert.equal(up.fits[0].part.pn, "CL21B106KOQNNNE");
    assert.deepEqual(up.fits[0].upgrades, ["16 V vs 10 V", "X7R vs X5R"]);
  });
  test("tally counts match the fits", () => {
    const r = rank(BY_PN.get("GRM188R71H104KA93D"), {mode:"equivalent", required:"commercial"});
    assert.equal(r.dropIns + r.reviews, r.fits.length);
  });
});
