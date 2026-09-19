"use strict";
/* اختبارات المطابقة مع سكربتات البايثون الأصلية — تعيش في مجلد خاص خارج المستودع العام
 * (Desktop\tamim-private\parity) لأنها تستخدم ملفات موردين حقيقية وإعدادات الشركات.
 * إن لم يوجد المجلد (مثل GitHub) تُتخطّى. لتخطّيها محليًا: TAMIM_PARITY=0 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const runner = path.join(__dirname, "..", "..", "tamim-private", "parity", "run-parity.js");
if (process.env.TAMIM_PARITY === "0" || !fs.existsSync(runner)) {
  console.log(`مطابقة البايثون: تُخطّيت (${fs.existsSync(runner) ? "TAMIM_PARITY=0" : "المجلد الخاص غير موجود"})`);
  console.log("\n0 passed, 0 failed");
  process.exit(0);
}
const r = spawnSync(process.execPath, [runner], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
process.stdout.write(r.stdout || "");
process.stderr.write(r.stderr || "");
process.exit(r.status === 0 ? 0 : 1);
