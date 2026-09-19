"use strict";
// اتساق ملفات التطبيق: كل سكربت/ستايل في index.html موجود، وكل رابط ?v= يساوي رقم الإصدار،
// وكل ملف في قائمة تخزين sw.js موجود، وكل ملف محلي في index.html مخزَّن في sw.js.
const fs = require("fs");
const path = require("path");
const root = path.join(__dirname, "..");
let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra ? " | " + JSON.stringify(extra) : "")); }
}

const { version } = require("../js/app/version.js");
check("version is positive integer", Number.isInteger(version) && version > 0, version);

const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const refs = [...html.matchAll(/(?:src|href)="([^"#:]+?)(\?v=(\d+))?"/g)].map((m) => ({ file: m[1], v: m[3] }));
const local = refs.filter((r) => r.file !== "./");
local.forEach((r) => check(`index.html ref exists: ${r.file}`, fs.existsSync(path.join(root, r.file))));
local.filter((r) => /\.(js|css)$/.test(r.file))
  .forEach((r) => check(`index.html ?v= matches version: ${r.file}`, Number(r.v) === version, r));

const scripts = [...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]);
const order = ["js/core/csv.js", "js/core/merge.js", "js/core/zip.js", "js/core/xlsx.js"];
const pos = order.map((f) => scripts.indexOf(f));
check("core scripts load in dependency order", pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), scripts);
check("version.js loads first", scripts[0] === "js/app/version.js", scripts);
check("tools load after core", scripts.indexOf("js/tools/merge.js") > pos[pos.length - 1], scripts);
check("shell loads last", scripts[scripts.length - 1] === "js/app/shell.js", scripts);

const swPath = path.join(root, "sw.js");
const sw = fs.existsSync(swPath) ? fs.readFileSync(swPath, "utf8") : "";
const assetsBlock = sw.match(/const ASSETS = \[([\s\S]*?)\];/);
check("sw.js has ASSETS", !!assetsBlock);
const assets = assetsBlock ? [...assetsBlock[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]) : [];
assets.filter((a) => a !== "./").forEach((a) => check(`sw asset exists: ${a}`, fs.existsSync(path.join(root, a))));
local.forEach((r) => check(`sw caches ${r.file}`, assets.includes(r.file)));
["manifest.webmanifest", "js/app/version.js", "js/app/pwa.js"].forEach((f) => check(`sw caches ${f}`, assets.includes(f)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
