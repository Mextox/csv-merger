"use strict";
const S = require("../js/core/serials.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });

// عشوائية ثابتة للاختبار: بايت متسلسل
const seq = () => { let i = 0; return (n) => Uint8Array.from({ length: n }, () => i++ & 0xff); };

/* ---------- السيريال والتاريخ ---------- */
eq("ymd", S.ymd(new Date(2026, 8, 5)), "20260905");
eq("batchSerial pads the index to 6", S.batchSerial("77", new Date(2026, 8, 5), 3), "7720260905000003");
eq("shortDate has no padding (as the old program)", S.shortDate(new Date(2026, 8, 5)), "592026");

/* ---------- توليد الأكواد ---------- */
{
  const r = S.generateCodes({ length: 6, count: 5, type: "digits", batch: "77", date: new Date(2026, 8, 5), random: seq() });
  eq("generated count", r.rows.length, 5);
  check("codes are digits of the right length", r.rows.every((x) => /^\d{6}$/.test(x.code)), r.rows[0]);
  eq("serials are sequential", r.rows.map((x) => x.serial.slice(-6)), ["000001", "000002", "000003", "000004", "000005"]);
  check("codes are unique", new Set(r.rows.map((x) => x.code)).size === 5);
  check("complete", r.complete && r.message === "");
  const letters = S.generateCodes({ length: 4, count: 3, type: "letters", batch: "1", random: seq() });
  check("letters only", letters.rows.every((x) => /^[A-Z]{4}$/.test(x.code)), letters.rows[0]);
  const both = S.generateCodes({ length: 8, count: 2, type: "both", batch: "1", random: seq() });
  check("letters+digits charset", both.rows.every((x) => /^[A-Z0-9]{8}$/.test(x.code)));
  // لا يكرر كودًا مولَّدًا سابقًا
  const known = new Set(["000"]);
  const r2 = S.generateCodes({ length: 3, count: 2, type: "digits", batch: "1", known, random: seq() });
  check("known codes are skipped", r2.rows.every((x) => x.code !== "000"), r2.rows);
  // مجال صغير: لا يدور إلى ما لا نهاية ويشرح السبب
  const tight = S.generateCodes({ length: 1, count: 20, type: "digits", batch: "1", random: seq() });
  check("stops and explains when it cannot complete", !tight.complete && tight.message.includes("تعذّر"), tight.message);
  check("returns keys of the new codes", new Set(r.newKeys).size === 5);
  const hashed = S.generateCodes({ length: 4, count: 2, type: "digits", batch: "1", random: seq(), hashOf: (c) => "h:" + c });
  check("hashOf is used for keys", hashed.newKeys.every((k) => k.startsWith("h:")), hashed.newKeys);
}

/* ---------- إضافة السيريال والأكواد ---------- */
{
  const rows = [["111"], ["222"], ["333"]];
  const out = S.insertSerials(rows, { date: new Date(2026, 8, 5), source: "src", category: "cat", companyCode: "10", classCode: "5" });
  eq("serial inserted as second column with company and class", out[0], ["111", "592026_src_cat_1", "10", "5"]);
  eq("numbering continues", out[2][1], "592026_src_cat_3");
  eq("extra columns are kept after the codes", S.insertSerials([["1", "x", "y"]], { date: new Date(2026, 8, 5), source: "s", category: "c", companyCode: "10", classCode: "5" })[0], ["1", "592026_s_c_1", "10", "5", "x", "y"]);
}

/* ---------- استخراج عمود وفلترة ---------- */
eq("pick column 2", S.pickColumn([["a", "b", "c"], ["d", "e", "f"]], 1), [["b"], ["e"]]);
eq("short rows are skipped", S.pickColumn([["a"], ["d", "e"]], 1), [["e"]]);
eq("filter by length", S.filterByLength([["12345", "x"], ["12", "y"], ["z", "1234567"]], 5), [["12345", "x"]]);
eq("filter trims before measuring", S.filterByLength([[" 12345 "]], 5), [[" 12345 "]]);

/* ---------- المطابقة ---------- */
{
  const values = S.searchValues([["111", ""], [" 222 "]]);
  check("search values trimmed, empties dropped", values.has("111") && values.has("222") && values.size === 2, [...values]);
  const r = S.matchSplit([["a", "111"], ["b", "999"], ["222", "c"]], values);
  eq("matched rows", r.matched, [["a", "111"], ["222", "c"]]);
  eq("unmatched rows", r.unmatched, [["b", "999"]]);
}

/* ---------- البحث عن سيريالات ---------- */
{
  const files = [
    { name: "a.csv", lines: ["111,aaa", "999,bbb"] },
    { name: "b.txt", lines: ["111,aaa,extra-long-line", "222,ccc"] },
  ];
  const r = S.searchSerials(files, ["111", "222", "333", "111"]);
  eq("keeps the longest line per serial", r.rows.map((x) => [x.serial, x.line, x.file]), [["111", "111,aaa,extra-long-line", "b.txt"], ["222", "222,ccc", "b.txt"]]);
  eq("missing serials reported", r.missing, ["333"]);
  eq("duplicates in the input are searched once", r.searched, 3);
  eq("parse serial list from lines or first CSV column", S.parseSerialList("111\n222,x\n\n ٣٣٣ "), ["111", "222", "333"]);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
