// Every substitution rule at its edges: equal, one step better, one step worse, and unknown.
// Synthetic parts, so a catalog change can't hide a rule change.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {evaluate, reviewFlags, rank, meetsGrade, parseNeedDate, specFromPartNumber, fmtDate} from "../js/rules.js";

const O = Object.freeze({pn:"ORIG", mfr:"Murata", cap:100000, v:50, pkg:"0603", diel:"X7R", tol:10, grade:"commercial",
  h:0.8, term:"standard", life:"Active", stock:0, lead:20, usd:0.005, fromPart:true});
const cand = (over = {}) => ({...O, pn:"CAND", stock:1000, lead:2, ...over});
const check = (r, key) => r.checks.find(k => k.key === key);
const flagKeys = r => r.flags.map(f => f.key);

describe("capacitance and case", () => {
  test("capacitance must match exactly", () => {
    assert.equal(check(evaluate(O, cand(), "commercial"), "cap").state, "ok");
    assert.equal(check(evaluate(O, cand({cap:100001}), "commercial"), "cap").state, "bad");
  });
  test("case must match; no case given asks to confirm the footprint", () => {
    assert.equal(check(evaluate(O, cand({pkg:"0805"}), "commercial"), "pkg").state, "bad");
    assert.equal(check(evaluate({...O, pkg:null}, cand(), "commercial"), "pkg").state, "warn");
  });
});

describe("rated voltage", () => {
  test("equal passes, higher needs review and counts as an upgrade, lower fails, unknown needs review", () => {
    assert.equal(check(evaluate(O, cand({v:50}), "commercial"), "v").state, "ok");
    const up = evaluate(O, cand({v:100}), "commercial");
    assert.equal(check(up, "v").state, "warn");
    assert.ok(up.upgrades.includes("100 V vs 50 V"));
    assert.equal(check(evaluate(O, cand({v:25}), "commercial"), "v").state, "bad");
    assert.equal(check(evaluate({...O, v:null}, cand(), "commercial"), "v").state, "warn");
  });
});

describe("dielectric and temperature", () => {
  test("same passes, a better class needs review, a worse class fails", () => {
    assert.equal(check(evaluate(O, cand(), "commercial"), "diel").state, "ok");
    assert.equal(check(evaluate(O, cand({diel:"C0G"}), "commercial"), "diel").state, "warn");
    assert.equal(check(evaluate(O, cand({diel:"X5R"}), "commercial"), "diel").state, "bad");
    assert.equal(check(evaluate(O, cand({diel:"Y5V"}), "commercial"), "diel").state, "bad");
  });
  test("a wider temperature range is fine, a narrower one fails", () => {
    const wider = check(evaluate({...O, diel:"X5R"}, cand({diel:"X7R"}), "commercial"), "temp");
    assert.deepEqual([wider.state, wider.level], ["ok", "minor"]);
    assert.equal(check(evaluate(O, cand({diel:"X5R"}), "commercial"), "temp").state, "bad");
  });
});

describe("tolerance", () => {
  test("equal passes, tighter is an upgrade, looser fails, unlisted needs review", () => {
    assert.equal(check(evaluate(O, cand({tol:10}), "commercial"), "tol").state, "ok");
    const tighter = evaluate(O, cand({tol:5}), "commercial");
    assert.deepEqual([check(tighter, "tol").state, check(tighter, "tol").level], ["ok", "minor"]);
    assert.ok(tighter.upgrades.length);
    assert.equal(check(evaluate(O, cand({tol:20}), "commercial"), "tol").state, "bad");
    assert.equal(check(evaluate(O, cand({tol:null}), "commercial"), "tol").state, "warn");
    assert.equal(check(evaluate({...O, tol:null}, cand(), "commercial"), "tol").state, "info");
  });
});

describe("grade", () => {
  test("AEC-Q200 replaces commercial; only medical replaces medical; commercial replaces neither", () => {
    const table = {commercial:[true, true, true], automotive:[false, true, false], medical:[false, false, true]};
    for (const [required, row] of Object.entries(table))
      ["commercial", "automotive", "medical"].forEach((g, i) => assert.equal(meetsGrade(g, required), row[i], `${g} for ${required}`));
  });
});

describe("lifecycle", () => {
  test("EOL fails, NRND needs review, active passes, unverified is a note", () => {
    assert.equal(check(evaluate(O, cand({life:"EOL"}), "commercial"), "life").state, "bad");
    assert.equal(check(evaluate(O, cand({life:"NRND"}), "commercial"), "life").state, "warn");
    assert.equal(check(evaluate(O, cand({life:"Active"}), "commercial"), "life").state, "ok");
    assert.equal(check(evaluate(O, cand({life:null}), "commercial"), "life").state, "info");
  });
});

describe("height", () => {
  test("same height passes; a different height in the same case is a note and a review flag", () => {
    assert.equal(check(evaluate(O, cand({h:0.8}), "commercial"), "h").state, "ok");
    const taller = evaluate(O, cand({h:1.25}), "commercial");
    assert.deepEqual([check(taller, "h").state, taller.verdict], ["info", "ok"]);
    assert.ok(flagKeys(taller).includes("height"));
  });
  test("an unknown height is grey, and flagged only when the voltage rating changes", () => {
    const same = evaluate(O, cand({h:null}), "commercial");
    assert.equal(check(same, "h").level, "unknown");
    assert.ok(!flagKeys(same).includes("height"));
    assert.ok(flagKeys(evaluate(O, cand({h:null, v:100}), "commercial")).includes("height"));
  });
});

describe("termination", () => {
  const flexO = {...O, term:"flex"};
  const autoO = {...flexO, grade:"automotive"};
  test("automotive: losing flexible termination needs review, and so does an unlisted one", () => {
    assert.equal(evaluate(autoO, cand({term:"standard", grade:"automotive"}), "automotive").verdict, "warn");
    assert.equal(evaluate(autoO, cand({term:null, grade:"automotive"}), "automotive").verdict, "warn");
    assert.equal(evaluate(autoO, cand({term:"flex", grade:"automotive"}), "automotive").verdict, "ok");
  });
  test("commercial: losing flexible termination is a note, not a review", () => {
    const r = evaluate(flexO, cand({term:"standard"}), "commercial");
    assert.equal(check(r, "term").state, "info");
    assert.equal(r.verdict, "ok");
  });
  test("gaining flexible termination is an upgrade", () => {
    assert.ok(evaluate(O, cand({term:"flex"}), "commercial").upgrades.includes("flexible termination"));
  });
  test("the termination flag appears on automotive boards only, when the termination differs or is unknown", () => {
    assert.ok(flagKeys(evaluate(O, cand({term:null}), "automotive")).includes("term"));
    assert.ok(flagKeys(evaluate(O, cand({term:"flex"}), "automotive")).includes("term"));
    assert.ok(!flagKeys(evaluate(O, cand({term:"standard"}), "automotive")).includes("term"));
    assert.ok(!flagKeys(evaluate(O, cand({term:null}), "commercial")).includes("term"));
  });
});

describe("DC bias flag", () => {
  test("not raised for the same design: manufacturer, voltage, dielectric and a known equal height", () => {
    assert.ok(!flagKeys(evaluate(O, cand(), "commercial")).includes("dcbias"));
  });
  test("raised for a class II part from another manufacturer, voltage or height, or an unknown height", () => {
    for (const over of [{mfr:"TDK"}, {v:100}, {h:1.25}, {h:null}])
      assert.ok(flagKeys(evaluate(O, cand(over), "commercial")).includes("dcbias"), JSON.stringify(over));
  });
  test("never raised for C0G; always raised for Y5V", () => {
    const c0g = {...O, diel:"C0G"};
    assert.ok(!flagKeys(evaluate(c0g, cand({diel:"C0G", mfr:"TDK"}), "commercial")).includes("dcbias"));
    assert.ok(reviewFlags({...O, diel:"Y5V"}, cand({diel:"Y5V"}), "commercial").some(f => f.key === "dcbias"));
  });
  test("flags never change the verdict", () => {
    const r = evaluate({...O, grade:"automotive"}, cand({mfr:"TDK", h:null, term:null, grade:"automotive"}), "automotive");
    assert.deepEqual(flagKeys(r).sort(), ["dcbias", "term"]);
    assert.equal(r.verdict, "ok");
  });
});

describe("ranking with flags", () => {
  test("among otherwise equal candidates, fewer review flags rank first", () => {
    const today = new Date(2026, 10, 9);
    const a = cand({pn:"A", mfr:"TDK", h:null}); // dcbias only
    const b = cand({pn:"B", mfr:"TDK", h:null, v:50}); // same as A
    const c = cand({pn:"C", mfr:"Murata", h:0.8});      // same design: no flags
    const {fits} = rank(O, {mode:"equivalent", required:"commercial", demand:{today}, candidates:[a, b, c]});
    assert.equal(fits[0].part.pn, "C");
  });
});

describe("need date", () => {
  const today = new Date(2026, 10, 9); // Mon 9 Nov 2026, ISO week 46
  const iso = r => r.date && fmtDate(r.date);
  test("words, ISO and planning weeks are read", () => {
    assert.equal(iso(parseNeedDate("9 Dec 2026", today)), "9 Dec 2026");
    assert.equal(iso(parseNeedDate("Dec 9, 2026", today)), "9 Dec 2026");
    assert.equal(iso(parseNeedDate("9-dec-2026", today)), "9 Dec 2026");
    assert.equal(iso(parseNeedDate("2026-12-09", today)), "9 Dec 2026");
    assert.equal(iso(parseNeedDate("wk 50", today)), "7 Dec 2026");
    assert.equal(iso(parseNeedDate("W2 2027", today)), "11 Jan 2027");
  });
  test("a date or week without a year is the next one from today", () => {
    assert.equal(iso(parseNeedDate("9 Dec", today)), "9 Dec 2026");
    assert.equal(iso(parseNeedDate("1 Mar", today)), "1 Mar 2027");
    assert.equal(iso(parseNeedDate("wk 46", today)), "9 Nov 2026");
    assert.equal(iso(parseNeedDate("wk 10", today)), "8 Mar 2027");
  });
  test("empty is no date; ambiguous and impossible dates are refused with a reason", () => {
    assert.deepEqual(parseNeedDate("  ", today), {date:null});
    assert.match(parseNeedDate("12/09/2026", today).error, /ambiguous/);
    assert.match(parseNeedDate("31 Feb 2027", today).error, /doesn’t have a day 31/);
    assert.match(parseNeedDate("wk 54 2026", today).error, /no week 54/);
    assert.ok(parseNeedDate("soon", today).error);
  });
});

describe("offline fallback spec", () => {
  test("a readable part number gives a matchable spec with unknown supply", () => {
    const s = specFromPartNumber("cl10b104kb8nnnc");
    assert.deepEqual([s.pn, s.mfr, s.cap, s.v, s.pkg, s.diel, s.stock, s.usd, s.offline], ["CL10B104KB8NNNC", "Samsung", 100000, 50, "0603", "X7R", null, null, true]);
    assert.equal(specFromPartNumber("GCM188R71H104KA57D").grade, "automotive");
  });
  test("unreadable formats or unranked dielectrics give nothing rather than a guess", () => {
    assert.equal(specFromPartNumber("LM358DR"), null);
    assert.equal(specFromPartNumber("GRM188C81A106MA73D"), null); // X6S isn't ranked by the rules
  });
});
