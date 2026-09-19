"use strict";
const vm = require("vm");
const fs = require("fs");
const path = require("path");
const { parseBatchTxt } = require("../js/core/batchtxt.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });
const same = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

const VALID = [
  "Batch:25176014",
  "Quantity:3",
  "FaceValue:5000",
  "[BEGIN]",
  "2517600639914 111122223333",
  "2517600639915 111122223334",
  "2517600639916 111122223335",
  "[END]",
].join("\n");

// --- ملف سليم
const ok = parseBatchTxt(VALID);
same("valid header", ok.header, { Batch: "25176014", Quantity: "3", FaceValue: "5000" });
same("valid rows", ok.rows, [
  ["2517600639914", "111122223333"],
  ["2517600639915", "111122223334"],
  ["2517600639916", "111122223335"],
]);
same("valid line numbers (1-based)", ok.lines, [5, 6, 7]);
same("valid has no issues", ok.issues, []);

// --- نهايات أسطر CRLF
same("CRLF gives same result", parseBatchTxt(VALID.replace(/\n/g, "\r\n")), ok);

// --- Quantity لا يطابق عدد الأسطر
const qty = parseBatchTxt(VALID.replace("Quantity:3", "Quantity:4"));
eq("quantity mismatch → one issue", qty.issues.length, 1);
eq("quantity mismatch code", qty.issues[0].code, "BATCH_QUANTITY");
eq("quantity mismatch level", qty.issues[0].level, "error");
same("quantity mismatch rows empty", qty.issues[0].rows, []);
check("quantity message has both numbers", /4/.test(qty.issues[0].message) && /3/.test(qty.issues[0].message), qty.issues[0].message);
eq("quantity mismatch keeps data rows", qty.rows.length, 3);

// --- علامات مفقودة أو بترتيب خاطئ
function expectFormatError(name, text, marker) {
  const res = parseBatchTxt(text);
  eq(name + " → one issue", res.issues.length, 1);
  eq(name + " code", res.issues[0] && res.issues[0].code, "BATCH_FORMAT");
  eq(name + " level", res.issues[0] && res.issues[0].level, "error");
  check(name + " message names " + marker, res.issues[0] && res.issues[0].message.includes(marker), res.issues[0]);
  same(name + " issue rows empty", res.issues[0] && res.issues[0].rows, []);
  same(name + " returns no rows", res.rows, []);
  same(name + " returns no lines", res.lines, []);
}
expectFormatError("missing [END]", VALID.replace("\n[END]", ""), "[END]");
expectFormatError("missing [BEGIN]", VALID.replace("[BEGIN]\n", ""), "[BEGIN]");
expectFormatError("[END] before [BEGIN]", "Batch:1\n[END]\n111 222\n[BEGIN]", "[END]");

// --- سطر بثلاثة أجزاء بين أسطر بجزأين: خطأ واحد برقم السطر، والسطر لا يُحذف
const odd = parseBatchTxt([
  "Quantity:4",
  "[BEGIN]",
  "111 aaa",
  "222 bbb extra",
  "333 ccc",
  "444 ddd",
  "[END]",
].join("\n"));
eq("odd part count → one issue", odd.issues.length, 1);
eq("odd part count code", odd.issues[0].code, "BATCH_FORMAT");
same("odd part count reports line number", odd.issues[0].rows, [4]);
check("odd part count message mentions expected count 2", /2/.test(odd.issues[0].message), odd.issues[0].message);
eq("odd row kept", odd.rows.length, 4);
same("odd row parts", odd.rows[1], ["222", "bbb", "extra"]);

const twoOdd = parseBatchTxt("[BEGIN]\n1 a\n2\n3 c\n4 d e\n[END]");
eq("two odd lines → still one issue", twoOdd.issues.length, 1);
same("two odd lines listed together", twoOdd.issues[0].rows, [3, 5]);

// --- أسطر فارغة داخل البيانات تُتجاهل، والمسافات/الجدولة تفصل الأجزاء
const blanks = parseBatchTxt([
  "Quantity:2",
  "[BEGIN]",
  "",
  "  111\t 222  ",
  "   ",
  "333    444",
  "",
  "[END]",
  "ignored after end",
].join("\n"));
same("blank lines ignored", blanks.rows, [["111", "222"], ["333", "444"]]);
same("blank lines skipped in line numbers", blanks.lines, [4, 6]);
same("blank lines cause no issues", blanks.issues, []);

// --- الرأس: القسمة على أول نقطتين فقط، وقصّ الطرفين
const hdr = parseBatchTxt("Note:a:b\n Batch : 123 \n[BEGIN]\n1 2\n[END]");
eq("header value keeps later colons", hdr.header.Note, "a:b");
eq("header key and value trimmed", hdr.header.Batch, "123");

// --- التسجيل في المتصفح (بلا module/require) تحت Tamim.core.batchtxt
const ctx = vm.createContext({});
ctx.globalThis = ctx;
const file = path.join(__dirname, "..", "js", "core", "batchtxt.js");
vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
check("browser registers Tamim.core.batchtxt", ctx.Tamim && ctx.Tamim.core.batchtxt && typeof ctx.Tamim.core.batchtxt.parseBatchTxt === "function");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
