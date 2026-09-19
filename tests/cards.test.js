"use strict";
const C = require("../js/core/cards.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const codes = (issues) => issues.map((i) => i.code);
const noFlags = () => ({ pin: [], serial: [] });
const rec = (pin, serial, company, categoryRaw, row, extra) =>
  Object.assign({ pin, serial, company, categoryRaw, file: "f.xlsx", sheet: "S", row, srcFlags: noFlags() }, extra || {});

/* ---------- أكواد الفئات ---------- */
{
  const recs = [rec("1", "a", "c", "كارت 10", 2), rec("2", "b", "c", "20", 3), rec("3", "d", "c", "كارت 10", 4), rec("4", "e", "c", "", 5)];
  eq("missing codes unique with suggestion, empty excluded", C.missingCategoryCodes(recs, { "20": "20" }), [{ raw: "كارت 10", suggestion: "10" }]);
  eq("suggestion falls back to raw", C.missingCategoryCodes([rec("1", "a", "c", "ذهبي", 2)], {}), [{ raw: "ذهبي", suggestion: "ذهبي" }]);
  eq("code-like raw suggested as is", C.missingCategoryCodes([rec("1", "a", "c", "h10", 2), rec("2", "b", "c", "5 LYD", 3)], {}).map((m) => m.suggestion), ["h10", "5"]);
  const r = C.assignCodes(recs, { "كارت 10": "10", "20": "20" });
  eq("assign codes", r.cards.map((c) => c.category), ["10", "20", "10", ""]);
  eq("categoryRaw kept", r.cards[0].categoryRaw, "كارت 10");
  check("empty category → NO_CATEGORY_CODE with row", codes(r.issues).includes("NO_CATEGORY_CODE") && r.issues[0].rows.includes(5), r.issues);
  const r2 = C.assignCodes([rec("1", "a", "", "20", 2)], { "20": "20" });
  eq("empty company → NO_COMPANY_CODE", codes(r2.issues), ["NO_COMPANY_CODE"]);
  const r3 = C.assignCodes([rec("1", "a", "c", "30", 2)], {});
  eq("unmapped category → NO_CATEGORY_CODE", codes(r3.issues), ["NO_CATEGORY_CODE"]);
}

/* ---------- الفحوص ---------- */
const card = (pin, serial, row, extra) => Object.assign({ pin, serial, company: "c", category: "10", categoryRaw: "10", file: "f.xlsx", sheet: "S", row, srcFlags: noFlags() }, extra || {});
{
  const cs = [card("111", "S1", 2), card("", "S2", 3), card("333", "", 4)];
  const iss = C.checkCards(cs, {});
  const e = iss.find((i) => i.code === "EMPTY_FIELD");
  check("EMPTY_FIELD error lists rows", e && e.level === "error" && JSON.stringify(e.rows) === "[3,4]", iss);
}
{
  const cs = [card("1234", "5678", 2, { srcFlags: { pin: [], serial: ["lossy"] } }), card("1.23E+15", "9", 3), card("5", "6", 4, { srcFlags: { pin: ["date"], serial: [] } })];
  const iss = C.checkCards(cs, {});
  const pl = iss.find((i) => i.code === "PRECISION_LOST");
  check("PRECISION_LOST from flag and scientific text", pl && pl.level === "error" && JSON.stringify(pl.rows) === "[2,3]", iss);
  const df = iss.find((i) => i.code === "DATE_FORMATTED_ID");
  check("DATE_FORMATTED_ID warning", df && df.level === "warning" && JSON.stringify(df.rows) === "[4]", iss);
}
{
  const cs = [card("111", "S1", 2), card("111", "S2", 3), card("222", "S2", 4, { file: "g.xlsx" })];
  const iss = C.checkCards(cs, {});
  const dp = iss.find((i) => i.code === "DUP_PIN");
  check("DUP_PIN error with duplicate row", dp && dp.level === "error" && JSON.stringify(dp.rows) === "[3]" && dp.message.includes("111"), iss);
  const ds = iss.find((i) => i.code === "DUP_SERIAL");
  check("DUP_SERIAL across files", ds && ds.file === "g.xlsx" && JSON.stringify(ds.rows) === "[4]", iss);
  const iss2 = C.checkCards([card("A", "A", 2), card("A", "A", 3)], { serialFromPin: true });
  eq("serialFromPin → only DUP_PIN reported", codes(iss2).filter((c) => c.startsWith("DUP")), ["DUP_PIN"]);
  eq("empty values not duplicates", codes(C.checkCards([card("", "S1", 2), card("", "S2", 3)], {})).filter((c) => c.startsWith("DUP")), []);
}
{
  const cs = [card("1111", "AAAA", 2), card("2222", "BBBB", 3), card("333", "CCCC", 4), card("4444", "DDDDD", 5)];
  const iss = C.checkCards(cs, {});
  const lo = iss.filter((i) => i.code === "LENGTH_OUTLIER");
  eq("LENGTH_OUTLIER per field", lo.map((i) => [i.level, JSON.stringify(i.rows)]), [["warning", "[4]"], ["warning", "[5]"]]);
  eq("no outlier with < 3 values", codes(C.checkCards([card("1", "a", 2), card("22", "bb", 3)], {})).filter((c) => c === "LENGTH_OUTLIER"), []);
}
{
  const iss = C.checkCards([card("12a4", "5678", 2), card("1234", "56-8", 3)], { digitsOnly: true });
  const nd = iss.find((i) => i.code === "NON_DIGIT");
  check("NON_DIGIT warning", nd && nd.level === "warning" && JSON.stringify(nd.rows) === "[2,3]", iss);
  eq("NON_DIGIT off by default", codes(C.checkCards([card("12a4", "5678", 2)], {})).includes("NON_DIGIT"), false);
}
{
  const cs = [card("1", "a", 2), card("2", "b", 3, { sheet: "T" })];
  cs[1].pin = "";
  const iss = C.checkCards(cs, {});
  eq("issues grouped by file+sheet", iss.filter((i) => i.code === "EMPTY_FIELD").map((i) => i.sheet), ["T"]);
}

/* ---------- الإخراج ---------- */
const out = (over) => Object.assign({ columns: ["pin", "serial", "company", "category"], fileName: "{company}_{category}.csv", groupBy: "category", chunkSize: 0, delimiter: ",", bom: false, header: false, lineEnding: "\r\n" }, over || {});
{
  const cs = [card("1", "a", 2), card("2", "b", 3, { category: "20", categoryRaw: "كارت 20" }), card("3", "c", 4), card("4", "d", 5, { company: "z" })];
  const r = C.buildOutputs(cs, out(), { date: "2026-09-19" });
  eq("files grouped by company then category", r.files.map((f) => f.path), ["c/c_10.csv", "c/c_20.csv", "z/z_10.csv"]);
  eq("file text csv rows with CRLF after each", r.files[0].text, "1,a,c,10\r\n3,c,c,10\r\n");
  eq("row counts", r.files.map((f) => f.rows), [2, 1, 1]);
  const r2 = C.buildOutputs(cs, out({ groupBy: "none", fileName: "{company}.csv" }), { date: "2026-09-19" });
  eq("groupBy none", r2.files.map((f) => [f.path, f.rows]), [["c/c.csv", 3], ["z/z.csv", 1]]);
  const r3 = C.buildOutputs(cs, out({ columns: ["serial", "pin", "company", "category"], delimiter: ";", lineEnding: "\n", header: true }), { date: "2026-09-19" });
  eq("column order, delimiter, header, LF", r3.files[0].text, "serial;pin;company;category\na;1;c;10\nc;3;c;10\n");
}
{
  const cs = [];
  for (let i = 1; i <= 5; i++) cs.push(card(String(i), "s" + i, i + 1, { file: "Order #3830 - LTT - 10 LYD.csv" }));
  const r = C.buildOutputs(cs, out({ chunkSize: 2, fileName: "LBY_{category}(#{sourceNumber})_{part}.CSV" }), { date: "2026-09-19" });
  eq("chunking with part numbers", r.files.map((f) => [f.path, f.rows]), [["c/LBY_10(#3830)_1.CSV", 2], ["c/LBY_10(#3830)_2.CSV", 2], ["c/LBY_10(#3830)_3.CSV", 1]]);
  const r2 = C.buildOutputs(cs, out({ chunkSize: 2 }), { date: "2026-09-19" });
  eq("collision adds _2 and warns", [r2.files.map((f) => f.path), codes(r2.issues)], [["c/c_10.csv", "c/c_10_2.csv", "c/c_10_3.csv"], ["NAME_COLLISION"]]);
  const r3 = C.buildOutputs([card("1", "a", 2, { categoryRaw: "كارت 10", file: "مورد/ملف 7.xlsx" })], out({ fileName: "{source}-{categoryRaw}-{date}.csv" }), { date: "2026-09-19" });
  eq("source/categoryRaw/date vars", r3.files[0].path, "c/ملف 7-كارت 10-2026-09-19.csv");
  const used = new Set(["c/c_10.csv"]);
  const r4 = C.buildOutputs([card("1", "a", 2)], out(), { date: "x", usedPaths: used });
  eq("shared usedPaths across profiles", r4.files[0].path, "c/c_10_2.csv");
  const r5 = C.buildOutputs([card("1", "a", 2, { company: "a/b" })], out(), { date: "x" });
  eq("unsafe chars sanitized", r5.files[0].path, "a-b/a-b_10.csv");
}
{
  eq("python-style quoting", C.buildOutputs([card('x,"y"', "a\nb", 2)], out(), { date: "x" }).files[0].text, '"x,""y""","a\nb",c,10\r\n');
  const bytes = C.encodeOutput("1,a", { bom: true });
  eq("BOM bytes", Array.from(bytes.slice(0, 3)), [0xef, 0xbb, 0xbf]);
  eq("no BOM", Array.from(C.encodeOutput("1", { bom: false })), [0x31]);
}
{
  const cs = [card("1", "a", 2), card("2", "b", 3), card("3", "c", 4, { category: "20" })];
  eq("summarize", C.summarize(cs), [{ company: "c", category: "10", count: 2 }, { company: "c", category: "20", count: 1 }]);
  const files = C.buildOutputs(cs, out(), { date: "x" }).files;
  eq("reconcile ok", C.reconcile({ readRows: 5, skippedEmpty: 2, cards: cs, files }).ok, true);
  const rc = C.reconcile({ readRows: 6, skippedEmpty: 2, cards: cs, files });
  check("reconcile mismatch", !rc.ok && rc.message.length > 0, rc);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
