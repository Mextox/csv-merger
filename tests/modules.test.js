"use strict";
// يحمّل ملفات js/core بترتيب index.html داخل سياق معزول بلا module/require (مثل المتصفح)
// ويتحقق أن كل وحدة سُجّلت في Tamim.core وأن الاعتمادات بينها تعمل.
const vm = require("vm");
const fs = require("fs");
const path = require("path");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra ? " | " + JSON.stringify(extra) : "")); }
}

// ترتيب index.html — الاسم المسجَّل قد يختلف عن اسم الملف (settings-pack ← settingsPack)
const ORDER = ["text", "csv", "merge", "zip", "xlsx", "ole", "crypto", "xlsx-crypt", "batchtxt", "profiles", "cards", "settings-pack"];
const REG = { "settings-pack": "settingsPack", "xlsx-crypt": "xlsxCrypt" };
const ctx = vm.createContext({ TextEncoder, TextDecoder, DecompressionStream, console });
ctx.globalThis = ctx;
for (const m of ORDER) {
  const file = path.join(__dirname, "..", "js", "core", m + ".js");
  vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
}
const core = ctx.Tamim && ctx.Tamim.core;
check("Tamim.core exists", !!core);
ORDER.forEach((m) => check(`module ${m} registered`, core && typeof core[REG[m] || m] === "object"));
check("profiles uses csv+text (fileInfo)", core.profiles.fileInfo(core.profiles.csvSource("a.csv", "PIN,SN\n1,2", "auto")).headers.join() === "PIN,SN");
check("cards uses text (missingCategoryCodes suggestion)", core.cards.missingCategoryCodes([{ categoryRaw: "كارت 10" }], {})[0].suggestion === "10");
check("csv.parseCSV works", core.csv.parseCSV("a,b\n1,2", ",").rows.length === 2);
check("merge uses csv (buildMerge)", core.merge.buildMerge(
  [core.csv.analyzeFile("x.csv", "a,b\n1,2", { skipEmpty: true }, null)],
  { columnMode: "union", skipEmpty: true }).rows.length === 1);
check("zip crc32 vector", core.zip.crc32(new TextEncoder().encode("123456789")) === 0xcbf43926);
check("xlsx exposes parseXlsx", typeof core.xlsx.parseXlsx === "function");
(async () => {
  let msg = "";
  try { await core.xlsx.parseXlsx(new Uint8Array([1, 2, 3, 4])); } catch (e) { msg = e.arMessage || ""; }
  check("xlsx error path uses zip.xlsxError", msg.includes("Excel"), msg);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
