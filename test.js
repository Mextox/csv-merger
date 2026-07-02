"use strict";
const { parseCSV, detectDelimiter, classifyValue, detectHasHeader, analyzeFile, crossFileChecks, buildMerge, toCSV } = require("./app.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra ? " | " + JSON.stringify(extra) : "")); }
}

// --- parseCSV: quoted fields, escaped quotes, newline inside quotes, CRLF
const p1 = parseCSV('a,"b,1","he said ""hi""","line1\nline2"\r\nx,y,z,w', ",");
check("parse quoted comma", p1.rows[0][1] === "b,1", p1.rows[0]);
check("parse escaped quote", p1.rows[0][2] === 'he said "hi"', p1.rows[0]);
check("parse newline in quotes", p1.rows[0][3] === "line1\nline2", p1.rows[0]);
check("parse CRLF second row", p1.rows.length === 2 && p1.rows[1].join("|") === "x|y|z|w", p1.rows);
check("no unclosed quote", p1.unclosedQuote === false);

const p2 = parseCSV('a,"unclosed\nmore', ",");
check("unclosed quote detected", p2.unclosedQuote === true);

// --- detectDelimiter
check("detect semicolon", detectDelimiter("a;b;c\n1;2;3\n4;5;6") === ";");
check("detect comma", detectDelimiter("a,b,c\n1,2,3") === ",");
check("detect tab", detectDelimiter("a\tb\tc\n1\t2\t3") === "\t");

// --- classifyValue
check("classify number", classifyValue("42") === "number");
check("classify decimal comma", classifyValue("12,5") === "number");
check("classify thousands", classifyValue("1,234,567") === "number");
check("classify date", classifyValue("2026-07-02") === "date");
check("classify text", classifyValue("خمسة") === "text");
check("classify arabic digits", classifyValue("٤٢") === "number");

// --- analyzeFile: demo file 1 (dup row, ragged row, type outlier)
const opts = { skipEmpty: true, dropDupes: false, caseInsensitive: false, columnMode: "union", addSource: false };
const demo1 =
  "الاسم,البريد,المدينة,العمر\n" +
  "أحمد علي,ahmed@mail.com,القاهرة,34\n" +
  "سارة محمد,sara@mail.com,جدة,28\n" +
  "خالد يوسف,khaled@mail.com,الرياض,خمسة وأربعون\n" +
  "منى حسن,mona@mail.com,الإسكندرية,31\n" +
  "أحمد علي,ahmed@mail.com,القاهرة,34\n" +
  "عمر سمير,omar@mail.com,دبي,40,حقل زائد\n" +
  "ليلى كريم,laila@mail.com,عمان,26\n" +
  "نور فؤاد,nour@mail.com,بيروت,29\n";
const a1 = analyzeFile("f1.csv", demo1, opts);
check("f1 headers", a1.headers.join("|") === "الاسم|البريد|المدينة|العمر", a1.headers);
check("f1 row count", a1.dataRows.length === 8, a1.dataRows.length);
check("f1 ragged error", a1.issues.some((i) => i.severity === "error" && i.message.includes("عدد حقوله")), a1.issues.map((i) => i.message));
check("f1 dup row warn", a1.issues.some((i) => i.message.includes("صف مكرر بالكامل")), a1.issues.map((i) => i.message));
check("f1 type outlier warn", a1.issues.some((i) => i.message.includes("قيم شاذة")), a1.issues.map((i) => i.message));

// --- analyzeFile: demo file 2 (repeated header = stacked table, empty row, extra column)
const demo2 =
  "البريد,الاسم,العمر,المدينة,الهاتف\n" +
  "hassan@mail.com,حسن إبراهيم,38,الدوحة,0501234567\n" +
  "fatma@mail.com,فاطمة عادل,27,الكويت,0559876543\n" +
  "\n" +
  "البريد,الاسم,العمر,المدينة,الهاتف\n" +
  "yousef@mail.com,يوسف ماهر,45,مسقط,0561112223\n" +
  "sara@mail.com,سارة محمد,28,جدة,0574445556\n";
const a2 = analyzeFile("f2.csv", demo2, opts);
check("f2 repeated header warn (stacked table)", a2.issues.some((i) => i.message.includes("أكثر من جدول")), a2.issues.map((i) => i.message));
check("f2 repeated header excluded", a2.dataRows.length === 4, a2.dataRows.length);
check("f2 empty row info", a2.issues.some((i) => i.message.includes("صف فارغ")), a2.issues.map((i) => i.message));

// --- crossFileChecks: extra column + order difference
const cross = crossFileChecks([a1, a2], opts);
check("cross extra column warn", cross.some((i) => i.message.includes('"الهاتف"') && i.message.includes("فقط")), cross.map((i) => i.message));

const sameColsA = analyzeFile("s1.csv", "a,b\n1,2\n3,4\n", opts);
const sameColsB = analyzeFile("s2.csv", "b,a\n5,6\n7,8\n", opts);
const cross2 = crossFileChecks([sameColsA, sameColsB], opts);
check("cross order info", cross2.some((i) => i.message.includes("ترتيب الأعمدة")), cross2.map((i) => i.message));

// case-only difference
const caseA = analyzeFile("c1.csv", "Email,Name\n1,2\n", opts);
const caseB = analyzeFile("c2.csv", "email,Name\n3,4\n", opts);
const cross3 = crossFileChecks([caseA, caseB], opts);
check("cross case warn", cross3.some((i) => i.message.includes("حالة الأحرف")), cross3.map((i) => i.message));

// --- buildMerge: union aligns by name, missing filled empty
const m1 = buildMerge([a1, a2], opts);
check("merge union headers", m1.headers.join("|") === "الاسم|البريد|المدينة|العمر|الهاتف", m1.headers);
check("merge row total", m1.rows.length === 12, m1.rows.length);
const hassanRow = m1.rows.find((r) => r[1] === "hassan@mail.com");
check("merge aligns by name", hassanRow && hassanRow[0] === "حسن إبراهيم" && hassanRow[3] === "38", hassanRow);
const f1Row = m1.rows.find((r) => r[1] === "ahmed@mail.com");
check("merge fills missing col", f1Row && f1Row[4] === "", f1Row);

// intersection mode
const mInt = buildMerge([a1, a2], { ...opts, columnMode: "intersection" });
check("merge intersection headers", mInt.headers.join("|") === "الاسم|البريد|المدينة|العمر", mInt.headers);

// dedupe + source column
const mDedup = buildMerge([a1, a2], { ...opts, dropDupes: true, addSource: true });
check("merge dedupe dropped 1 (in-file dup)", mDedup.droppedDupes >= 1, mDedup.droppedDupes);
check("merge source col", mDedup.headers[mDedup.headers.length - 1] === "الملف المصدر", mDedup.headers);
check("merge source value", mDedup.rows[0][mDedup.rows[0].length - 1] === "f1.csv", mDedup.rows[0]);

// case-insensitive merge
const mCase = buildMerge([caseA, caseB], { ...opts, caseInsensitive: true });
check("merge case-insensitive single email col", mCase.headers.length === 2, mCase.headers);

// duplicate headers rename
const dupH = analyzeFile("d.csv", "id,name,name\n1,a,b\n2,c,d\n", opts);
check("dup header renamed", dupH.headers.join("|") === "id|name|name (2)", dupH.headers);

// empty header named
const emptyH = analyzeFile("e.csv", "id,,x\n1,2,3\n", opts);
check("empty header named", emptyH.headers[1] === "عمود_2", emptyH.headers);

// --- headerless detection
check("detect header: text row", detectHasHeader(["الاسم", "البريد", "المدينة"]) === true);
check("detect headerless: numbers", detectHasHeader(["1", "2", "3"]) === false);
check("detect headerless: email", detectHasHeader(["أحمد", "ahmed@mail.com", "القاهرة"]) === false);
check("detect headerless: date", detectHasHeader(["فاتورة", "2026-01-15"]) === false);

// numeric first row → auto headerless, all rows are data
const numH = analyzeFile("n.csv", "1,2,3\n4,5,6\n7,8,9\n", opts);
check("numeric file auto headerless", numH.hasHeader === false, numH.hasHeader);
check("headerless keeps all rows", numH.dataRows.length === 3, numH.dataRows.length);
check("headerless info message", numH.issues.some((i) => i.message.includes("بدون صف عناوين")), numH.issues.map((i) => i.message));
check("headerless positional headers", numH.headers.join("|") === "عمود_1|عمود_2|عمود_3", numH.headers);

// manual override: force header on
const forced = analyzeFile("n.csv", "1,2,3\n4,5,6\n7,8,9\n", opts, true);
check("override forces header", forced.hasHeader === true && forced.dataRows.length === 2, forced);
// manual override: force headerless off a text file
const forcedOff = analyzeFile("t.csv", "a,b\nc,d\n", opts, false);
check("override forces headerless", forcedOff.hasHeader === false && forcedOff.dataRows.length === 2, forcedOff);

// all files headerless → positional merge, no header row in output
const hl1 = analyzeFile("h1.csv", "أحمد,ahmed@mail.com,34\nسارة,sara@mail.com,28\n", opts);
const hl2 = analyzeFile("h2.csv", "حسن,hassan@mail.com,38\n", opts);
check("hl files detected headerless", hl1.hasHeader === false && hl2.hasHeader === false);
const mHl = buildMerge([hl1, hl2], opts);
check("all-headerless merge no header flag", mHl.includeHeader === false);
check("all-headerless merge rows", mHl.rows.length === 3, mHl.rows);
check("all-headerless no-header info", mHl.issues.some((i) => i.message.includes("لن يُضاف صف عناوين")), mHl.issues.map((i) => i.message));
const csvHl = toCSV(null, mHl.rows, ",");
check("toCSV without header row", csvHl.split("\r\n").length === 3 && csvHl.startsWith("أحمد,"), csvHl.split("\r\n")[0]);

// mixed: named file + headerless file → positional alignment to output columns
const mMix = buildMerge([a1, hl1], opts);
check("mixed merge keeps header", mMix.includeHeader === true);
check("mixed merge warn positional", mMix.issues.some((i) => i.message.includes("محاذاة أعمدته حسب الموقع")), mMix.issues.map((i) => i.message));
const hlRow = mMix.rows.find((r) => r[1] === "ahmed@mail.com" && r[0] === "أحمد");
check("mixed merge positional values", hlRow && hlRow[2] === "34" && hlRow[3] === "", hlRow);

// all-headerless with different column counts → warn
const hl3 = analyzeFile("h3.csv", "علي,ali@mail.com,40,إضافي\n", opts);
const crossHl = crossFileChecks([hl1, hl3], opts);
check("headerless col count mismatch warn", crossHl.some((i) => i.message.includes("عدد الأعمدة يختلف")), crossHl.map((i) => i.message));

// empty file
const ef = analyzeFile("empty.csv", "", opts);
check("empty file flagged", ef.empty === true && ef.issues.some((i) => i.severity === "error"));

// --- toCSV escaping round-trip
const csv = toCSV(["a", "b"], [['x,"y', "line1\nline2"], ["plain", "z"]], ",");
const back = parseCSV(csv, ",");
check("csv round-trip", back.rows[1][0] === 'x,"y' && back.rows[1][1] === "line1\nline2" && back.rows[2][0] === "plain", back.rows);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
