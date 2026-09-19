"use strict";
// يشغّل كل tests/*.test.js كعملية مستقلة ويجمع النتائج. يخرج بـ 1 عند أي فشل.
const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".test.js")).sort();
let failedFiles = 0;
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
  const summary = out.trim().split("\n").pop();
  console.log(`${r.status === 0 ? "✔" : "✘"} ${f} — ${summary}`);
  fails.forEach((l) => console.log("    " + l));
  if (r.status !== 0) failedFiles++;
}
console.log(failedFiles ? `\n${failedFiles} ملف اختبار فشل` : `\nكل ملفات الاختبار نجحت (${files.length})`);
process.exit(failedFiles ? 1 : 0);
