"use strict";
/* اختبارات المطابقة مع سكربتات البايثون الأصلية — تعيش في مجلد خاص خارج المستودع العام
 * (Desktop\tamim-private\parity) لأنها تستخدم ملفات موردين حقيقية وإعدادات الشركات.
 * إن لم يوجد المجلد (مثل GitHub) تُتخطّى. لتخطّيها محليًا: TAMIM_PARITY=0 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const dir = path.join(__dirname, "..", "..", "tamim-private", "parity");
const runners = ["run-parity.js", "run-split-parity.js"].map((f) => path.join(dir, f)).filter((f) => fs.existsSync(f));
if (process.env.TAMIM_PARITY === "0" || !runners.length) {
  console.log(`مطابقة البايثون: تُخطّيت (${runners.length ? "TAMIM_PARITY=0" : "المجلد الخاص غير موجود"})`);
  console.log("\n0 passed, 0 failed");
  process.exit(0);
}
let passed = 0, failed = 0;
runners.forEach((runner) => {
  const r = spawnSync(process.execPath, [runner], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = r.stdout || "";
  process.stdout.write(out);
  process.stderr.write(r.stderr || "");
  const m = out.match(/(\d+) passed, (\d+) failed/);
  if (m) { passed += Number(m[1]); failed += Number(m[2]); }
  else failed++;
});
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
