"use strict";
const S = require("../js/core/split.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

const CARDS = ["p1,s1,10,5", "p2,s2,10,5", "p3,s3,10,5", "p4,s4,10,5", "p5,s5,10,5"].join("\n") + "\n";

/* ---------- الأسطر والمدى ---------- */
eq("toLines drops the trailing empty line only", S.toLines("a\nb\n"), ["a", "b"]);
eq("toLines keeps inner empty lines", S.toLines("a\n\nb\n"), ["a", "", "b"]);
eq("toLines handles CRLF", S.toLines("a\r\nb\r\n"), ["a", "b"]);
eq("range last N", S.rangeOf(10, { lastLines: 3 }), { from: 7, to: 10 });
eq("range last N bigger than file", S.rangeOf(2, { lastLines: 9 }), { from: 0, to: 2 });
eq("range start+count", S.rangeOf(10, { startLine: 3, count: 4 }), { from: 2, to: 6 });
eq("range count 0 = to the end", S.rangeOf(10, { startLine: 4, count: 0 }), { from: 3, to: 10 });
eq("range count beyond end is clamped", S.rangeOf(5, { startLine: 4, count: 99 }), { from: 3, to: 5 });
eq("range defaults to whole file", S.rangeOf(5, {}), { from: 0, to: 5 });
eq("lastLines wins over startLine", S.rangeOf(10, { lastLines: 2, startLine: 5, count: 5 }), { from: 8, to: 10 });

/* ---------- تحويل الأسطر ---------- */
eq("protect columns keeps all columns", S.transformLine("a,b,c,d", { protectColumns: true }), "a,b,c,d");
eq("no protect keeps first two only", S.transformLine("a,b,c,d", { protectColumns: false }), "a,b");
eq("swap first two (LBY) keeps the rest", S.transformLine("a,b,c,d", { protectColumns: true, swapFirstTwo: true }), "b,a,c,d");
eq("swap with no protect", S.transformLine("a,b,c,d", { protectColumns: false, swapFirstTwo: true }), "b,a");
eq("template codes appended", S.transformLine("a,b", { protectColumns: true, codes: ["10", "5"] }), "a,b,10,5");
eq("line with one column stays as is", S.transformLine(" solo ", { protectColumns: true, codes: ["10"] }), "solo");
eq("line is trimmed", S.transformLine("  a,b  ", { protectColumns: true }), "a,b");

/* ---------- الأخذ والمتبقي ---------- */
{
  const r = S.takeLines(CARDS, { lastLines: 2, protectColumns: true });
  eq("take last 2", r.taken, ["p4,s4,10,5", "p5,s5,10,5"]);
  eq("remaining keeps the rest in order", r.remaining, ["p1,s1,10,5", "p2,s2,10,5", "p3,s3,10,5"]);
  eq("range reported 1-based", [r.from, r.to, r.total], [4, 5, 5]);
  const r2 = S.takeLines(CARDS, { startLine: 2, count: 2, protectColumns: false, swapFirstTwo: true, codes: ["10", "5"] });
  eq("take range with swap + codes", r2.taken, ["s2,p2,10,5", "s3,p3,10,5"]);
  eq("remaining around the range", r2.remaining, ["p1,s1,10,5", "p4,s4,10,5", "p5,s5,10,5"]);
  eq("take nothing when count is 0 rows available", S.takeLines("", { lastLines: 3 }).taken, []);
}

/* ---------- التقسيم والأسماء ---------- */
eq("chunk splits evenly", S.chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
eq("chunk size 0 = one chunk", S.chunk([1, 2, 3], 0), [[1, 2, 3]]);
eq("chunk empty", S.chunk([], 5), []);
eq("part name", S.partName("LBY_10", 0, 1), "LBY_10_1.csv");
eq("part name with start number", S.partName("LBY_10", 2, 7), "LBY_10_9.csv");
eq("folder date is dd-mm-yyyy", S.folderDate(new Date(2026, 8, 22)), "22-09-2026");
{
  const parts = S.buildParts(["a", "b", "c"], { splitSize: 2, sourceName: "order.csv", date: new Date(2026, 8, 22) });
  eq("parts paths inside today's folder", parts.map((p) => p.path), ["22-09-2026/order_1.csv", "22-09-2026/order_2.csv"]);
  eq("part text is LF joined without trailing newline", parts[0].text, "a\nb");
  eq("part line counts", parts.map((p) => p.lines), [2, 1]);
  const flat = S.buildParts(["a"], { customName: "دفعة", folder: false, startNumber: 3 });
  eq("custom name, no folder, custom start number", flat[0].path, "دفعة_3.csv");
}

/* ---------- سحب كمية (DOJON) ---------- */
{
  const r = S.pullQuantity(CARDS, 2);
  eq("pull last 2 rows", r.taken.map((x) => x[0]), ["p4", "p5"]);
  eq("remaining rows", r.remaining.map((x) => x[0]), ["p1", "p2", "p3"]);
  eq("category code from 4th column", r.categoryCode, "5");
  eq("total rows", r.total, 5);
  eq("pull more than available takes all", S.pullQuantity(CARDS, 99).taken.length, 5);
  eq("pull 0 takes nothing", S.pullQuantity(CARDS, 0).taken.length, 0);
  eq("empty file", S.pullQuantity("", 3), { taken: [], remaining: [], total: 0, categoryCode: "" });
  const t = { code: "5", start: "Batch:1\nQuantity:2\n[BEGIN]", end: "[END]" };
  eq("batch export writes serial then pin", S.batchExport(r.taken, t), "Batch:1\nQuantity:2\n[BEGIN]\ns4 p4\ns5 p5\n[END]");
  eq("templateFor picks by code", S.templateFor([{ code: "10" }, t], "5"), t);
  eq("templateFor missing", S.templateFor([{ code: "10" }], "5"), null);
}

/* ---------- إضافة نص ---------- */
eq("append text to each non-empty line", S.appendToLines("a,b\n\nc,d\n", " x "), "a,b,x\n\nc,d,x");
eq("rowsToText", S.rowsToText([["a", "b"], ["c", "d"]]), "a,b\nc,d");

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
