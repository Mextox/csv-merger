"use strict";
const P = require("../js/core/profiles.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, JSON.stringify(got) === JSON.stringify(want), { got, want });
const codes = (issues) => issues.map((i) => i.code);

function profile(over) {
  const p = P.defaultProfile();
  p.id = "p1";
  p.name = "شركة تجريبية";
  p.company = { from: "fixed", value: "abc" };
  p.fields.pin = { names: ["PIN", "الرقم السري"], index: 2 };
  p.fields.serial = { names: ["SN", "السيريال"], index: 1 };
  p.fields.category = { from: "column", names: ["Value", "الفئة"], index: 5 };
  return Object.assign(p, over || {});
}
const sheet = (rows, extra) => Object.assign({ sheetName: "Sheet1", rows, flags: { lossy: [], date: [] } }, extra || {});
const src = (sheets, fileName) => ({ fileName: fileName || "ملف.xlsx", sheets });

/* ---------- الإعداد الافتراضي والتحقق ---------- */
{
  const d = P.defaultProfile();
  eq("default output columns", d.output.columns, ["pin", "serial", "company", "category"]);
  eq("default output format", [d.output.delimiter, d.output.bom, d.output.header, d.output.lineEnding, d.output.groupBy, d.output.chunkSize], [",", false, false, "\r\n", "category", 0]);
  eq("default input", [d.input.format, d.input.sheets, d.input.header, d.input.delimiter], ["table", "all", "auto", "auto"]);
  check("default profile is invalid until filled (no name)", !P.validateProfile(d).ok);
  check("filled profile valid", P.validateProfile(profile()).ok, P.validateProfile(profile()).errors);
  const bad = profile({ rules: [{ op: "explode", field: "pin" }] });
  const v = P.validateProfile(bad);
  check("unknown rule op rejected", !v.ok && v.errors.some((e) => e.includes("explode") && e.includes("1")), v.errors);
  const bad2 = profile({ rules: [{ op: "padStart", field: "pin" }] });
  check("padStart without length rejected", !P.validateProfile(bad2).ok);
  const bad3 = profile({ rules: [{ op: "digitsOnly", field: "phone" }] });
  check("rule on unknown field rejected", !P.validateProfile(bad3).ok);
  const bad4 = profile();
  bad4.fields.pin = { names: [] };
  check("pin without names or index rejected", !P.validateProfile(bad4).ok);
  const bad5 = profile();
  bad5.fields.category = { from: "moon" };
  check("unknown category source rejected", !P.validateProfile(bad5).ok);
  const bad6 = profile();
  bad6.output.columns = ["pin", "serial", "company"];
  check("output columns must be the 4 fields", !P.validateProfile(bad6).ok);
  const bad7 = profile();
  bad7.company = { from: "fixed", value: "" };
  check("fixed company needs value", !P.validateProfile(bad7).ok);
  const ok8 = profile({ rules: [
    { op: "fillDown", field: "category" }, { op: "digitsOnly", field: "category" },
    { op: "padStart", field: "serial", length: 7 }, { op: "concat", target: "pin", parts: [{ field: "serial", padStart: 7 }, { field: "pin", padStart: 6 }] },
    { op: "copy", from: "pin", to: "serial" }, { op: "replace", field: "pin", find: "ZL", with: "JF" },
    { op: "map", field: "category", table: { 5000: "5" }, strict: true }, { op: "prefixIf", field: "category", value: "h", fileNameContains: ["هوت سبوت"] },
  ] });
  check("all known rules valid", P.validateProfile(ok8).ok, P.validateProfile(ok8).errors);
}

/* ---------- التعرّف التلقائي ---------- */
{
  const p = profile({ detect: { headers: ["PIN", "SN", "Value"], fileName: ["ozon"], sheetNames: [] } });
  const s1 = P.scoreProfile(p, { fileName: "ozon 10.xlsx", headers: ["pin", "SN", "Other"], sheetNames: ["Sheet1"] });
  check("score headers 2/3 + fileName", Math.abs(s1 - (100 * (60 * 2 / 3 + 25)) / 85) < 1e-9, s1);
  const s2 = P.scoreProfile(p, { fileName: "x.xlsx", headers: null, sheetNames: [] });
  eq("score headerless + no name = 0", s2, 0);
  const none = profile({ detect: { headers: [], fileName: [], sheetNames: [] } });
  eq("no criteria = 0", P.scoreProfile(none, { fileName: "a", headers: ["PIN"], sheetNames: [] }), 0);
  const onlyName = profile({ detect: { headers: [], fileName: ["Order #"], sheetNames: [] } });
  eq("only fileName criterion matched = 100", P.scoreProfile(onlyName, { fileName: "Order #12 - LTT - 10 LYD.csv", headers: null, sheetNames: [] }), 100);
  const sheetP = profile({ detect: { headers: [], fileName: [], sheetNames: ["vodafone"] } });
  eq("sheet name criterion", P.scoreProfile(sheetP, { fileName: "a.xlsx", headers: [], sheetNames: ["Vodafone 50LE"] }), 100);

  const a = profile({ id: "a", detect: { headers: ["PIN", "SN", "Value"], fileName: [], sheetNames: [] } });
  const b = profile({ id: "b", detect: { headers: ["code", "serial"], fileName: [], sheetNames: [] } });
  const r1 = P.rankProfiles([b, a], { fileName: "f.xlsx", headers: ["PIN", "SN", "Value"], sheetNames: [] });
  eq("rank picks best auto", [r1.decision, r1.ranked[0].profile.id], ["auto", "a"]);
  const r2 = P.rankProfiles([a], { fileName: "f.xlsx", headers: ["PIN", "x", "y"], sheetNames: [] });
  eq("rank manual below 40", r2.decision, "manual"); // 1/3 × 100 = 33
  const r3 = P.rankProfiles([a], { fileName: "f.xlsx", headers: ["PIN", "SN", "y"], sheetNames: [] });
  eq("rank confirm band", r3.decision, "confirm"); // 66.7
  const c = profile({ id: "c", detect: { headers: ["PIN", "SN", "Value"], fileName: [], sheetNames: [] } });
  const r4 = P.rankProfiles([a, c], { fileName: "f.xlsx", headers: ["PIN", "SN", "Value"], sheetNames: [] });
  eq("tie at top = manual", r4.decision, "manual");
  eq("rank empty list", P.rankProfiles([], { fileName: "x", headers: [], sheetNames: [] }).decision, "manual");
  // تساوي الدرجة: الأكثر تحديدًا (عناوين مطابقة أكثر) يفوز
  const three = profile({ id: "three", detect: { headers: ["PIN", "SN", "Value"], fileName: [], sheetNames: [] } });
  const eight = profile({ id: "eight", detect: { headers: ["Series", "SN", "PIN", "Username", "Password", "Value", "Expiration", "Used"], fileName: [], sheetNames: [] } });
  const r5 = P.rankProfiles([three, eight], { fileName: "f.xlsx", headers: ["Series", "SN", "PIN", "Username", "Password", "Value", "Expiration", "Used"], sheetNames: [] });
  eq("more specific profile wins a score tie", [r5.decision, r5.ranked[0].profile.id], ["auto", "eight"]);
}

/* ---------- معلومات التعرّف ---------- */
{
  const s = (rows) => ({ fileName: "a.xlsx", sheets: [{ sheetName: "S", rows }] });
  eq("fileInfo skips title rows", P.fileInfo(s([["فاتورة 5"], [], ["PIN", "SN"], ["1", "2"]])).headers, ["PIN", "SN"]);
  eq("fileInfo header on first row", P.fileInfo(s([["PIN", "SN"], ["1", "2"]])).headers, ["PIN", "SN"]);
  eq("fileInfo headerless", P.fileInfo(s([["1", "2"], ["3", "4"]])).headers, null);
  eq("fileInfo data-first file stays headerless", P.fileInfo(s([["1", "2"], ["PIN", "SN"]])).headers, null);
  eq("fileInfo batch", P.fileInfo({ fileName: "x.txt", batch: {} }), { fileName: "x.txt", headers: null, sheetNames: [] });
}

/* ---------- تحديد الأعمدة ---------- */
{
  eq("resolve exact name", P.resolveColumn({ names: ["SN"], index: 9 }, ["PIN", " sn ", "Value"]), { index: 1, byIndex: false });
  eq("resolve partial name", P.resolveColumn({ names: ["serial"], index: 9 }, ["PIN", "Serial Number"]), { index: 1, byIndex: false });
  eq("exact beats partial", P.resolveColumn({ names: ["pin"] }, ["pin code", "PIN"]), { index: 1, byIndex: false });
  eq("fallback index when no name", P.resolveColumn({ names: ["xyz"], index: 0 }, ["PIN", "SN"]), { index: 0, byIndex: true });
  eq("index when headerless", P.resolveColumn({ names: ["PIN"], index: 2 }, null), { index: 2, byIndex: false });
  check("error when nothing", !!P.resolveColumn({ names: ["xyz"] }, ["PIN"]).error);
  eq("index-only ref with headers is not a warning", P.resolveColumn({ names: [], index: 1 }, ["a", "b"]), { index: 1, byIndex: false });
  eq("empty first match falls to next name", P.resolveColumn({ names: ["الكود", "الرقم السري"] }, ["الكود", "الرقم السري (PIN)", "السيريال"], [["", "123", "s"], ["", "456", "t"]]), { index: 1, byIndex: false });
  eq("non-empty first match kept", P.resolveColumn({ names: ["الكود", "الرقم السري"] }, ["الكود", "الرقم السري (PIN)"], [["9", "123"]]), { index: 0, byIndex: false });
}

/* ---------- القراءة والتطبيق ---------- */
{
  const rows = [
    ["#", "SN", "PIN", "x", "y", "Value"],
    ["1", "0001", "111", "", "", "10"],
    ["", "", "", "", "", ""],
    ["2", "0002", "222", "", "", "20"],
  ];
  const r = P.applyProfile(profile(), src([sheet(rows)]), {});
  eq("records pin/serial/company/categoryRaw", r.records.map((x) => [x.pin, x.serial, x.company, x.categoryRaw]), [["111", "0001", "abc", "10"], ["222", "0002", "abc", "20"]]);
  eq("readRows / skippedEmpty", [r.readRows, r.skippedEmpty], [3, 1]);
  eq("record row numbers are file lines", r.records.map((x) => x.row), [2, 4]);
  eq("no issues", codes(r.issues), []);
}
{
  // عمود بالرقم رغم وجود عناوين ← تحذير COLUMN_BY_INDEX
  const rows = [["a", "b", "c", "d", "e", "Value"], ["1", "S1", "P1", "", "", "5"]];
  const r = P.applyProfile(profile(), src([sheet(rows)]), {});
  check("COLUMN_BY_INDEX warning", codes(r.issues).includes("COLUMN_BY_INDEX"), r.issues);
  eq("still reads by index", [r.records[0].pin, r.records[0].serial], ["P1", "S1"]);
}
{
  // صف العناوين ليس الأول: فاتورة فوقها عنوان وتاريخ
  const rows = [["فاتورة رقم 55"], ["التاريخ", "2026-06-01"], [], ["#", "SN", "PIN", "x", "y", "Value"], ["1", "S1", "P1", "", "", "10"], ["2", "S2", "P2", "", "", "10"]];
  const r = P.applyProfile(profile(), src([sheet(rows)]), {});
  eq("header row found below title rows", r.records.map((x) => [x.pin, x.serial, x.row]), [["P1", "S1", 5], ["P2", "S2", 6]]);
  eq("title rows not counted as data", [r.readRows, codes(r.issues)], [2, []]);
  // سري وسيريال في نفس الصف مطلوبان: صف فيه PIN فقط لا يُعتبر رأسًا
  const rows2 = [["PIN note"], ["PIN"], ["#", "SN", "PIN", "x", "y", "Value"], ["1", "S1", "P1", "", "", "10"]];
  eq("header needs both pin and serial names", P.applyProfile(profile(), src([sheet(rows2)]), {}).records.map((x) => x.row), [4]);
}
{
  // header: "no"
  const p = profile();
  p.input.header = "no";
  const r = P.applyProfile(p, src([sheet([["1", "S1", "P1", "", "", "5"], ["2", "S2", "P2", "", "", "5"]])]), {});
  eq("header no → all rows data", r.records.length, 2);
  eq("header no → no COLUMN_BY_INDEX", codes(r.issues), []);
}
{
  // header auto: الصف الأول أرقام ← بلا عناوين
  const r = P.applyProfile(profile(), src([sheet([["1", "S1", "P1", "", "", "5"]])]), {});
  eq("header auto detects data row", r.records.length, 1);
}
{
  // الفئة من اسم الملف
  const p = profile();
  p.fields.category = { from: "fileName", pick: "lastNumber" };
  const r = P.applyProfile(p, src([sheet([["#", "SN", "PIN"], ["1", "S", "P"]])], "Order #3830 - LTT - 10 LYD.csv"), {});
  eq("category lastNumber from file name", r.records[0].categoryRaw, "10");
  p.fields.category = { from: "fileName", pick: "firstNumber" };
  const r2 = P.applyProfile(p, src([sheet([["#", "SN", "PIN"], ["1", "S", "P"]])], "Order #3830 - LTT - 10 LYD.csv"), {});
  eq("category firstNumber from file name", r2.records[0].categoryRaw, "3830");
}
{
  // الفئة والشركة من اسم الورقة مع تخطي الملخص والتصحيح الإملائي
  const p = profile({ company: { from: "sheetName", map: { vodafone: "010", etisalat: "011" }, fuzzy: true } });
  p.fields.category = { from: "sheetName", pick: "firstNumber" };
  p.fields.pin = { names: ["الكود"] };
  p.fields.serial = { names: ["السيريال"] };
  p.input.skipSheets = ["ملخص"];
  const s = src([
    sheet([["الكود", "السيريال"], ["C1", "S1"]], { sheetName: "Vodafone 200LE" }),
    sheet([["الكود", "السيريال"], ["C2", "S2"]], { sheetName: "Etisalst 50LE" }),
    sheet([["x"], ["y"]], { sheetName: "ملخص الفاتورة" }),
  ]);
  const r = P.applyProfile(p, s, {});
  eq("sheetName company + category", r.records.map((x) => [x.company, x.categoryRaw, x.sheet]), [["010", "200", "Vodafone 200LE"], ["011", "50", "Etisalst 50LE"]]);
  check("FUZZY_COMPANY warning", codes(r.issues).includes("FUZZY_COMPANY"), r.issues);
  const p2 = JSON.parse(JSON.stringify(p));
  p2.company.fuzzy = false;
  const r2 = P.applyProfile(p2, s, {});
  eq("no fuzzy → company empty for misspelled", r2.records[1].company, "");
}
{
  // ask
  const p = profile({ company: { from: "ask" } });
  p.fields.category = { from: "ask" };
  const r = P.applyProfile(p, src([sheet([["#", "SN", "PIN"], ["1", "S", "P"]])]), { company: "999", category: "30" });
  eq("ask answers used", [r.records[0].company, r.records[0].categoryRaw], ["999", "30"]);
  const p2 = profile({ company: { from: "column", names: ["الشركة"], map: { "وي": "015" } } });
  const r2 = P.applyProfile(p2, src([sheet([["#", "SN", "PIN", "x", "y", "Value", "الشركة"], ["1", "S", "P", "", "", "5", "وي"]])]), {});
  eq("company from column + map", r2.records[0].company, "015");
  p.fields.category = { from: "fixed", value: "7" };
  eq("fixed category", P.applyProfile(p, src([sheet([["#", "SN", "PIN"], ["1", "S", "P"]])]), { company: "1" }).records[0].categoryRaw, "7");
}
{
  // القواعد: giga
  const p = profile({ company: { from: "fixed", value: "giga" } });
  p.fields.category = { from: "column", names: ["Category"], index: 0 };
  p.fields.serial = { names: ["Voucher"], index: 1 };
  p.fields.pin = { names: ["PIN"], index: 2 };
  p.rules = [
    { op: "fillDown", field: "category" },
    { op: "digitsOnly", field: "category" },
    { op: "concat", target: "pin", parts: [{ field: "serial", padStart: 7 }, { field: "pin", padStart: 6 }] },
    { op: "copy", from: "pin", to: "serial" },
  ];
  const rows = [["Category", "Voucher", "PIN"], ["5 LYD", "123", "45"], ["", "124", "46"], ["10 LYD", "9", "1"]];
  const r = P.applyProfile(p, src([sheet(rows)]), {});
  eq("giga rules", r.records.map((x) => [x.pin, x.serial, x.categoryRaw]),
    [["0000123000045", "0000123000045", "5"], ["0000124000046", "0000124000046", "5"], ["0000009000001", "0000009000001", "10"]]);
  check("copy marks serialFromPin", r.serialFromPin === true);
}
{
  // replace + padStart + map + prefixIf
  const p = profile();
  p.rules = [
    { op: "replace", field: "pin", find: "ZL", with: "JF" },
    { op: "padStart", field: "serial", length: 6 },
    { op: "map", field: "category", table: { "5000": "5", "10000": "10" }, strict: false },
    { op: "prefixIf", field: "category", value: "h", fileNameContains: ["هوت سبوت", "Hotspot"] },
  ];
  const rows = [["#", "SN", "PIN", "x", "y", "Value"], ["1", "12", "ZL1ZL", "", "", "5000"], ["2", "3", "P", "", "", "77"]];
  const r = P.applyProfile(p, src([sheet(rows)], "باقات هوت سبوت.xlsx"), {});
  eq("replace/pad/map/prefix", r.records.map((x) => [x.pin, x.serial, x.categoryRaw]), [["JF1JF", "000012", "h5"], ["P", "000003", "h77"]]);
  const p2 = JSON.parse(JSON.stringify(p));
  p2.rules[2].strict = true;
  const r2 = P.applyProfile(p2, src([sheet(rows)], "a.xlsx"), {});
  check("MAP_STRICT error", codes(r2.issues).includes("MAP_STRICT") && r2.issues.find((i) => i.code === "MAP_STRICT").rows.includes(3), r2.issues);
}
{
  // الصف الفارغ يُحدَّد قبل القواعد (fillDown لا يحيي صفًا فارغًا)
  const p = profile();
  p.fields.category = { from: "column", names: ["Category"], index: 0 };
  p.rules = [{ op: "fillDown", field: "category" }];
  const rows = [["Category", "SN", "PIN"], ["5", "S1", "P1"], ["", "", ""], ["", "S2", "P2"]];
  const r = P.applyProfile(p, src([sheet(rows)]), {});
  eq("empty row skipped before fillDown", [r.records.length, r.skippedEmpty, r.records[1].categoryRaw], [2, 1, "5"]);
}
{
  // أعلام المصدر تنتقل للسجل
  const s = sheet([["#", "SN", "PIN", "x", "y", "Value"], ["1", "1.2E+15", "P", "", "", "5"]]);
  s.flags.lossy.push({ row: 1, col: 1 });
  const r = P.applyProfile(profile(), src([s]), {});
  eq("srcFlags serial lossy", r.records[0].srcFlags, { pin: [], serial: ["lossy"] });
}
{
  // ملف إعداد غير صالح ← PROFILE_INVALID بلا سجلات
  const r = P.applyProfile(profile({ rules: [{ op: "nope" }] }), src([sheet([["a"], ["b"]])]), {});
  eq("invalid profile", [codes(r.issues), r.records.length], [["PROFILE_INVALID"], 0]);
  // عمود مطلوب غير موجود
  const p = profile();
  p.fields.pin = { names: ["غير موجود"] };
  const r2 = P.applyProfile(p, src([sheet([["#", "SN"], ["1", "S"]])]), {});
  check("missing column → PROFILE_INVALID", codes(r2.issues).includes("PROFILE_INVALID"), r2.issues);
}
{
  // Batch TXT
  const p = profile({ company: { from: "fixed", value: "3" } });
  p.input.format = "batchTxt";
  p.fields.serial = { names: [], index: 0 };
  p.fields.pin = { names: [], index: 1 };
  p.fields.category = { from: "batchHeader", key: "FaceValue" };
  p.rules = [{ op: "map", field: "category", table: { "5000": "5" }, strict: true }];
  const batch = { header: { FaceValue: "5000", Quantity: "2" }, rows: [["S1", "P1"], ["S2", "P2"]], lines: [5, 6], issues: [] };
  const r = P.applyProfile(p, { fileName: "Order.txt", batch }, {});
  eq("batch records", r.records.map((x) => [x.pin, x.serial, x.company, x.categoryRaw, x.row]), [["P1", "S1", "3", "5", 5], ["P2", "S2", "3", "5", 6]]);
  const r2 = P.applyProfile(p, { fileName: "Order.txt", batch: Object.assign({}, batch, { issues: [{ level: "error", code: "BATCH_QUANTITY", message: "x", rows: [] }] }) }, {});
  check("batch issues forwarded", codes(r2.issues).includes("BATCH_QUANTITY"));
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
