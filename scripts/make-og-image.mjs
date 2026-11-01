// Regenerates og-image.png (1200x627, the LinkedIn link-preview size) and
// apple-touch-icon.png (180x180, from favicon.svg).
//
//   npm run og-image
//
// Needs Playwright with Chromium, which is not a project dependency:
//   npm i --no-save playwright && npx playwright install chromium
// Fonts load from Google Fonts, so it needs network access.

import {createRequire} from "node:module";
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

let chromium;
try {
  ({chromium} = createRequire(import.meta.url)("playwright"));
} catch {
  console.error("Playwright isn’t installed. Run: npm i --no-save playwright && npx playwright install chromium");
  process.exit(1);
}

// Verdicts shown are real results from the page for GRM188R71H104KA93D.
const pockets = [
  {pn:"CC0603KRX7R9BB104",  mfr:"Yageo",   v:"ok",   label:"Drop-in"},
  {pn:"GRM188R72A104KA35D", mfr:"Murata",  v:"warn", label:"Fits, needs review"},
  {pn:"CL10F104ZB8NNNC",    mfr:"Samsung", v:"bad",  label:"Not compatible"}
];

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Barlow:wght@500;600&family=Barlow+Semi+Condensed:wght@700&family=JetBrains+Mono:wght@500&display=block" rel="stylesheet">
<style>
  :root{--bg:#EEF1F3;--surface:#FFFFFF;--ink:#17222E;--muted:#56636F;--line:#CDD4DA;--tape:#26303B;--accent:#1E5BB8;
    --ok:#1F6E43;--ok-bg:#E3F2E9;--warn:#8A540A;--warn-bg:#FBEFD9;--bad:#A12E2E;--bad-bg:#F7E3E3}
  *{box-sizing:border-box}
  html,body{margin:0;width:1200px;height:627px;overflow:hidden}
  body{background:var(--bg);color:var(--ink);font-family:"Barlow",sans-serif;display:flex;-webkit-font-smoothing:antialiased}
  .text{flex:1;padding:64px 40px 56px 72px;display:flex;flex-direction:column}
  .kicker{font-family:"JetBrains Mono",monospace;font-size:20px;color:var(--accent);letter-spacing:.04em;margin-bottom:22px}
  h1{font-family:"Barlow Semi Condensed",sans-serif;font-weight:700;font-size:72px;line-height:1.02;letter-spacing:-.01em;margin:0}
  .lede{font-size:26px;line-height:1.35;color:var(--muted);margin:24px 0 0;max-width:30ch}
  .by{margin-top:auto;font-size:22px;font-weight:600}
  .by span{color:var(--muted);font-weight:500}
  .tape{width:470px;margin:0 0 0 0;background:var(--tape);padding:56px 36px 56px 76px;position:relative;display:flex;flex-direction:column;justify-content:center;gap:22px}
  .tape::before{content:"";position:absolute;left:24px;top:0;bottom:0;width:28px;
    background:radial-gradient(circle at 14px 21px,var(--bg) 9px,transparent 9.5px) 0 0/28px 42px repeat-y}
  .pocket{background:var(--surface);border-radius:5px;padding:22px 24px}
  .pn{font-family:"JetBrains Mono",monospace;font-size:24px;font-weight:500}
  .mfr{color:var(--muted);font-size:20px;margin-top:2px}
  .chip{display:inline-block;margin-top:14px;font-weight:600;font-size:19px;padding:4px 14px;border-radius:999px}
  .ok{background:var(--ok-bg);color:var(--ok)} .warn{background:var(--warn-bg);color:var(--warn)} .bad{background:var(--bad-bg);color:var(--bad)}
</style></head><body>
  <div class="text">
    <div class="kicker">MLCC ALTERNATE FINDER</div>
    <h1>Your capacitor is on allocation. Find a drop-in alternate.</h1>
    <p class="lede">Every candidate checked against real substitution rules, with the reason it passes or fails.</p>
    <div class="by">Ricardo Vázquez <span>· Supply chain consultant</span></div>
  </div>
  <div class="tape">${pockets.map(p => `
    <div class="pocket"><div class="pn">${p.pn}</div><div class="mfr">${p.mfr}</div><span class="chip ${p.v}">${p.label}</span></div>`).join("")}
  </div>
</body></html>`;

const browser = await chromium.launch();
try {
  const og = await browser.newPage({viewport:{width:1200, height:627}});
  await og.setContent(html, {waitUntil:"networkidle"});
  await og.evaluate(() => document.fonts.ready);
  await og.screenshot({path:path.join(root, "og-image.png")});

  const svg = await readFile(path.join(root, "favicon.svg"), "utf8");
  const icon = await browser.newPage({viewport:{width:180, height:180}});
  await icon.setContent(`<style>html,body{margin:0;background:#26303B}svg{display:block;width:180px;height:180px}</style>${svg}`);
  await icon.screenshot({path:path.join(root, "apple-touch-icon.png")});
  console.log("Wrote og-image.png and apple-touch-icon.png");
} finally {
  await browser.close();
}
