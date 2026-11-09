// Run before each deploy: runs the tests, then bumps ?v=N on css/styles.css, js/app.js and the
// rules.js import, so browsers never mix an old and a new file after GitHub Pages updates.
import {execSync} from "node:child_process";
import {readFileSync, writeFileSync} from "node:fs";

execSync("npm test", {stdio: "inherit"});

const FILES = ["index.html", "js/app.js"];
const current = Math.max(...FILES.flatMap(f => [...readFileSync(f, "utf8").matchAll(/\?v=(\d+)/g)].map(m => +m[1])));
const next = current + 1;
for (const f of FILES) writeFileSync(f, readFileSync(f, "utf8").replace(/\?v=\d+/g, `?v=${next}`));
console.log(`Asset version ${current} → ${next}`);
