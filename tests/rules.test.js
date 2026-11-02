import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
  CATALOG, BY_PN, fmtCap, fmtTol, fmtWeek, isoWeek, meetsGrade, parseQuery, parseQty,
  evaluate, rank, approvalPath, supplyPlan, changeType, costPlan, CHECK_ROWS, liveSources
} from "../rules.js";

const TODAY = new Date(2026, 10, 2); // Monday, ISO week 45

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
  test("new manufacturer is an AML note that doesn’t change the verdict", () => {
    const r = evaluate(o, BY_PN.get("CL10B104KB8NNNC"), "commercial");
    assert.equal(r.verdict, "ok");
    assert.ok(r.checks.some(k => k.state === "info" && k.text === "New manufacturer: needs an AML entry"));
    const same = evaluate(o, BY_PN.get("GCM188R71H104KA57D"), "commercial");
    assert.ok(same.checks.some(k => k.text === "Same manufacturer, already on your AML"));
  });
  test("description searches ask to confirm the manufacturer is on the AML", () => {
    const r = evaluate(spec("0.1uF 50V X7R 0603"), BY_PN.get("CL10B104KB8NNNC"), "commercial");
    assert.ok(r.checks.some(k => k.text === "Confirm Samsung is on your AML"));
  });
  test("lifecycle: unverified is a note, NRND needs review, EOL is ruled out", () => {
    const c = BY_PN.get("CL10B104KB8NNNC");
    assert.ok(evaluate(o, c, "commercial").checks.some(k => k.state === "info" && /Lifecycle not verified/.test(k.text)));
    assert.equal(evaluate(o, {...c, life:"Active"}, "commercial").verdict, "ok");
    assert.equal(evaluate(o, {...c, life:"NRND"}, "commercial").verdict, "warn");
    assert.equal(evaluate(o, {...c, life:"EOL"}, "commercial").verdict, "bad");
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
  test("equivalent mode without a need date sorts by type of change, fit, usable date, then lead time and stock", () => {
    const {fits} = rank(BY_PN.get("GRM188R71H104KA93D"), {mode:"equivalent", required:"commercial", demand:{today:TODAY}});
    const order = {ok:0, warn:1};
    for (let i = 1; i < fits.length; i++){
      const a = fits[i - 1], b = fits[i];
      const cmp = a.change.order - b.change.order || order[a.verdict] - order[b.verdict] || a.plan.usableWeeks - b.plan.usableWeeks
        || a.part.lead - b.part.lead || b.part.stock - a.part.stock;
      assert.ok(cmp <= 0, `${a.part.pn} should not rank above ${b.part.pn}`);
    }
    // Same manufacturer, in stock: only the AML step, so it is usable first.
    assert.equal(fits[0].part.pn, "GCM188R71H104KA57D");
    assert.equal(fits[0].plan.usableWeeks, 1);
  });
  test("with a need date, on-time parts rank first, then the smallest type of change", () => {
    const demand = {qty:250000, needBy:new Date(2026, 10, 30), today:TODAY};
    const r = rank(spec("GRM188R71H104KA93D"), {mode:"equivalent", required:"commercial", demand});
    assert.equal(r.onTime, 4);
    assert.deepEqual(pns(r.fits.slice(0, 4)),
      ["CC0603KRX7R9BB104", "CL10B104KB8NNNC", "C1608X7R1H104K080AA", "GRM188R72A104KA35D"]);
    assert.ok(r.fits.slice(4).every(f => f.plan.onTime === false && f.plan.lateWeeks > 0));
    // GCM188 has only 8k of the 250k in stock, so it waits for the 22-week factory lead time.
    const gcm = r.fits.find(f => f.part.pn === "GCM188R71H104KA57D");
    assert.equal(gcm.plan.usableWeeks, 22);
    assert.equal(r.original.onTime, false);
    assert.equal(r.original.late, 22);
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
  test("tally counts by type of change match the fits", () => {
    const r = rank(BY_PN.get("GRM188R71H104KA93D"), {mode:"equivalent", required:"commercial"});
    assert.equal(r.dropIns + r.minor + r.major, r.fits.length);
    assert.deepEqual([r.dropIns, r.minor, r.major], [1, 6, 1]);
  });
});

describe("demand and supply", () => {
  test("quantity accepts plain numbers, separators and k/M suffixes", () => {
    assert.equal(parseQty("250000"), 250000);
    assert.equal(parseQty("250,000"), 250000);
    assert.equal(parseQty("250k"), 250000);
    assert.equal(parseQty("1.2M"), 1200000);
    assert.equal(parseQty(" 5000 pcs"), 5000);
    assert.equal(parseQty(""), null);
    assert.ok(Number.isNaN(parseQty("abc")));
    assert.ok(Number.isNaN(parseQty("0")));
  });
  test("stock that covers the quantity is available now; otherwise the factory lead time", () => {
    const part = BY_PN.get("C1608X7R1H104K080AA"); // 120k stock, 4 wk lead
    const full = supplyPlan(part, {qty:100000, today:TODAY});
    assert.deepEqual([full.fromStock, full.supplyWeeks, full.coverage], [true, 0, 1]);
    const partial = supplyPlan(part, {qty:240000, today:TODAY});
    assert.deepEqual([partial.fromStock, partial.supplyWeeks, partial.coverage], [false, 4, 0.5]);
    const noQty = supplyPlan(part, {today:TODAY});
    assert.deepEqual([noQty.fromStock, noQty.coverage], [true, null]);
  });
  test("weeks and dates format as ISO weeks, with the year only when it differs", () => {
    assert.equal(isoWeek(TODAY), 45);
    assert.equal(isoWeek(new Date(2026, 11, 28)), 53);
    assert.equal(isoWeek(new Date(2027, 0, 4)), 1);
    assert.equal(fmtWeek(new Date(2026, 10, 30), TODAY), "wk 49 · Nov 30");
    assert.equal(fmtWeek(new Date(2027, 4, 3), TODAY), "wk 18 · May 3, 2027");
  });
});

describe("approval path", () => {
  const o = BY_PN.get("GRM188R71H104KA93D");
  const path = (pn, required = "commercial", orig = o) => approvalPath(orig, evaluate(orig, BY_PN.get(pn), required), required);
  test("same manufacturer drop-in: AML entry only", () => {
    const p = path("GCM188R71H104KA57D");
    assert.deepEqual(p.steps.map(s => s.key), ["aml"]);
    assert.equal(p.weeks, 1);
  });
  test("new manufacturer adds samples and build validation", () => {
    const p = path("CL10B104KB8NNNC");
    assert.deepEqual(p.steps.map(s => s.key), ["mfr", "aml"]);
    assert.equal(p.weeks, 4);
  });
  test("a part that needs review adds engineering review", () => {
    assert.deepEqual(path("GRM188R72A104KA35D").steps.map(s => s.key), ["eng", "aml"]);
  });
  test("an automotive design adds PPAP and customer approval", () => {
    const p = path("CGA3E2X7R1H104K080AA", "automotive");
    assert.deepEqual(p.steps.map(s => s.key), ["mfr", "ppap", "aml"]);
    assert.equal(p.weeks, 10);
  });
  test("a description search can’t tell if the manufacturer is new, so it plans for samples", () => {
    const d = spec("0.1uF 50V X7R 0603");
    assert.deepEqual(path("CL10B104KB8NNNC", "commercial", d).steps.map(s => s.key), ["mfrChk", "aml"]);
  });
  test("usable date is the later of supply and approval", () => {
    const demand = {qty:50000, needBy:new Date(2027, 0, 25), today:TODAY};
    const r = rank(o, {mode:"equivalent", required:"automotive", demand});
    const cga = r.fits.find(f => f.part.pn === "CGA3E2X7R1H104K080AA"); // 64k in stock, 10 wk approval
    assert.equal(cga.plan.supply.supplyWeeks, 0);
    assert.equal(cga.plan.usableWeeks, 10);
    assert.equal(cga.plan.onTime, true);
    const gcm = r.fits.find(f => f.part.pn === "GCM188R71H104KA57D"); // 8k in stock, 22 wk lead, 7 wk approval
    assert.equal(gcm.plan.usableWeeks, 22);
    assert.equal(gcm.plan.onTime, false);
  });
});

describe("datasheet comparison levels", () => {
  const o = BY_PN.get("GRM188R71H104KA93D");
  const levels = (c, required = "commercial", orig = o) =>
    Object.fromEntries(evaluate(orig, BY_PN.get(c), required).checks.map(k => [k.key, k.level]));
  test("every check is a row, in a fixed order", () => {
    assert.deepEqual(evaluate(o, BY_PN.get("CL10B104KB8NNNC"), "commercial").checks.map(k => k.key), CHECK_ROWS);
  });
  test("identical specs are green; a new manufacturer and unverified lifecycle are yellow", () => {
    const l = levels("CL10B104KB8NNNC");
    for (const k of ["cap", "pkg", "v", "diel", "temp", "tol", "grade"]) assert.equal(l[k], "same", k);
    assert.equal(l.mfr, "minor");
    assert.equal(l.life, "minor");
  });
  test("same manufacturer is green", () => {
    assert.equal(levels("GCM188R71H104KA57D").mfr, "same");
  });
  test("a higher grade is yellow, not red", () => {
    assert.equal(levels("GCM188R71H104KA57D").grade, "minor");
  });
  test("a higher voltage needs a product engineer (red)", () => {
    assert.equal(levels("GRM188R72A104KA35D").v, "critical");
  });
  test("a dielectric upgrade is red, its wider temperature range yellow", () => {
    const l = levels("CL21B106KOQNNNE", "commercial", spec("CAP CER 10UF 10V X5R 0805"));
    assert.equal(l.diel, "critical");
    assert.equal(l.temp, "minor");
  });
  test("a spec missing from the description is red", () => {
    const l = levels("CL10B104KB8NNNC", "commercial", spec("100n 0603"));
    assert.equal(l.v, "critical");
    assert.equal(l.diel, "critical");
  });
  test("a tighter tolerance is yellow", () => {
    const l = levels("CC0603JRNPO9BN101", "commercial", spec("100pF 50V C0G 0603 10%"));
    assert.equal(l.tol, "minor");
  });
});

describe("type of change", () => {
  const o = BY_PN.get("GRM188R71H104KA93D");
  const type = (pn, required = "commercial") => {
    const r = evaluate(o, BY_PN.get(pn), required);
    return changeType(approvalPath(o, r, required)).type;
  };
  test("same manufacturer and fit is a drop-in", () => assert.equal(type("GCM188R71H104KA57D"), "dropin"));
  test("a new manufacturer is a minor change", () => assert.equal(type("CL10B104KB8NNNC"), "minor"));
  test("anything a product engineer must review is a major change", () => assert.equal(type("GRM188R72A104KA35D"), "major"));
  test("an automotive design change is major because of PPAP", () => assert.equal(type("GCM188R71H104KA57D", "automotive"), "major"));
});

describe("cost", () => {
  test("unit price, total and difference against the original", () => {
    const o = BY_PN.get("GRM188R71H104KA93D"); // US$0.0045
    const c = costPlan(o, BY_PN.get("CC0603KRX7R9BB104"), 250000); // US$0.0022
    assert.equal(c.unit, 0.0022);
    assert.equal(Math.round(c.total), 550);
    assert.equal(Math.round(c.deltaTotal), -575);
    assert.equal(Math.round(c.deltaPct * 100), -51);
  });
  test("without a quantity or an original price there is no total or difference", () => {
    const c = costPlan(spec("0.1uF 50V X7R 0603"), BY_PN.get("CC0603KRX7R9BB104"), null);
    assert.deepEqual([c.total, c.deltaUnit, c.deltaPct], [null, null, null]);
  });
  test("every catalog part has a simulated price", () => {
    assert.ok(CATALOG.every(p => typeof p.usd === "number" && p.usd > 0));
  });
});

describe("live sources", () => {
  test("link to each search page with the part number encoded", () => {
    const links = liveSources("GRM188R71H104KA93D");
    assert.deepEqual(links.map(l => l.name), ["TrustedParts", "Octopart", "Findchips", "Digi-Key", "Mouser"]);
    assert.ok(links.every(l => l.url.startsWith("https://") && l.url.includes("GRM188R71H104KA93D")));
    assert.ok(liveSources("A B/C").every(l => l.url.includes("A%20B%2FC")));
  });
});
