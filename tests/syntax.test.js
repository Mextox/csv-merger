"use strict";
// فحص تركيب كل ملفات JavaScript المنشورة — ملفات الواجهة لا تُحمَّل في اختبارات Node،
// فخطأ قوس فيها كان يصل إلى المتصفح صامتًا (حدث فعلًا في settings.js).
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}

const root = path.join(__dirname, "..");
const files = ["sw.js"];
["js/core", "js/app", "js/tools"].forEach((dir) => {
  fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith(".js")).sort().forEach((f) => files.push(`${dir}/${f}`));
});
check("found all app scripts", files.length >= 20, files.length);

files.forEach((rel) => {
  const src = fs.readFileSync(path.join(root, rel), "utf8");
  let err = "";
  try { new vm.Script(src, { filename: rel }); } catch (e) { err = e.message; }
  check(`syntax ok: ${rel}`, err === "", err);
});

// كل ملف مذكور في index.html و sw.js موجود فعلًا (تكرار مقصود مع app-shell لكن من زاوية الملفات)
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
[...html.matchAll(/<script src="([^"?]+)/g)].map((m) => m[1]).forEach((f) => {
  check(`index.html script exists: ${f}`, fs.existsSync(path.join(root, f)));
  check(`index.html script is syntax-checked: ${f}`, files.includes(f));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
