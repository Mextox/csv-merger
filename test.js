"use strict";
const { parseCSV, detectDelimiter, classifyValue, detectHasHeader, analyzeFile, crossFileChecks, buildMerge, toCSV, autoMergePlan, mergeWithMaps } = require("./app.js");

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

// --- الدمج الموضعي "الذكي": مثال المستخدم حرفيًا (ملفان أرقام بلا رأس)
const posA = analyzeFile("posA.csv", "10,100,500\n", opts);
const posB = analyzeFile("posB.csv", "100,50,1000\n", opts);
check("pos example both headerless", posA.hasHeader === false && posB.hasHeader === false, [posA.hasHeader, posB.hasHeader]);
const mPos = buildMerge([posA, posB], opts);
check("pos example no header row", mPos.includeHeader === false);
check("pos example 3 columns", mPos.headers.length === 3, mPos.headers);
check("pos example 2 rows", mPos.rows.length === 2, mPos.rows);
check("pos example column alignment (first under first)",
  mPos.rows[0].join("|") === "10|100|500" && mPos.rows[1].join("|") === "100|50|1000", mPos.rows);

// --- خرائط الأعمدة: الخطة التلقائية مطابقة لسلوك buildMerge
const planAB = autoMergePlan([a1, a2], opts);
check("auto plan cols count", planAB.finalCols.length === 5, planAB.finalCols.length);
check("auto plan map named file nulls missing", planAB.maps[0][4] === null && planAB.maps[0][0] === 0, planAB.maps[0]);
check("auto plan map reordered-by-name file", planAB.maps[1].join(",") === "1,0,3,2,4", planAB.maps[1]);
const baseMap = mergeWithMaps([a1, a2], opts, planAB);
check("mergeWithMaps matches buildMerge headers", baseMap.headers.join("|") === "الاسم|البريد|المدينة|العمر|الهاتف", baseMap.headers);
check("mergeWithMaps matches buildMerge rows", baseMap.rows.length === 12, baseMap.rows.length);
check("mergeWithMaps returns row sources", baseMap.sources.length === 12 && baseMap.sources[0] === 0 && baseMap.sources[11] === 1, baseMap.sources);

function clonePlan(p) {
  return { finalCols: p.finalCols.slice(), headers: p.headers.slice(), includeHeader: p.includeHeader, maps: p.maps.map((m) => m.slice()) };
}

// إعادة ترتيب أعمدة الناتج: انقل العمود 0 (الاسم) إلى النهاية لكل الملفات معًا
const reord = clonePlan(planAB);
[reord.finalCols, reord.headers, ...reord.maps].forEach((arr) => { const [x] = arr.splice(0, 1); arr.splice(4, 0, x); });
const mReord = mergeWithMaps([a1, a2], opts, reord);
check("reorder output headers", mReord.headers.join("|") === "البريد|المدينة|العمر|الهاتف|الاسم", mReord.headers);
const hassanReord = mReord.rows.find((r) => r[0] === "hassan@mail.com");
check("reorder keeps values aligned", hassanReord && hassanReord[4] === "حسن إبراهيم" && hassanReord[2] === "38", hassanReord);

// تبديل عمودين لملف واحد فقط: بدّل خريطة a1 بين الموضعين 0 و1، وتحقق أن a2 لم يتأثر
const swap = clonePlan(planAB);
const tmp = swap.maps[0][0]; swap.maps[0][0] = swap.maps[0][1]; swap.maps[0][1] = tmp;
const mSwap = mergeWithMaps([a1, a2], opts, swap);
const ahmedSwap = mSwap.rows.find((r) => r[0] === "ahmed@mail.com"); // الآن العمود 0 يحمل بريد a1
check("swap one file: col0 now holds its email", ahmedSwap && ahmedSwap[1] === "أحمد علي", ahmedSwap);
const hassanSwap = mSwap.rows.find((r) => r[1] === "hassan@mail.com"); // الملف الآخر بلا تغيير
check("swap one file: other file unchanged", hassanSwap && hassanSwap[0] === "حسن إبراهيم", hassanSwap);

// خرائط ملف بدون رأس + إعادة ترتيب أعمدته موضعيًا
const planHl = autoMergePlan([hl1, hl2], opts);
check("headerless plan no header row", planHl.includeHeader === false);
check("headerless plan positional maps", planHl.maps[0].join(",") === "0,1,2" && planHl.maps[1].join(",") === "0,1,2", planHl.maps);
const hlSwap = clonePlan(planHl);
const t2 = hlSwap.maps[0][0]; hlSwap.maps[0][0] = hlSwap.maps[0][2]; hlSwap.maps[0][2] = t2; // بدّل العمود الأول والثالث لـ hl1
const mHlSwap = mergeWithMaps([hl1, hl2], opts, hlSwap);
check("headerless swap file col", mHlSwap.rows[0][0] === "34" && mHlSwap.rows[0][2] === "أحمد", mHlSwap.rows[0]);
check("headerless swap other file untouched", mHlSwap.rows[2][0] === "حسن", mHlSwap.rows[2]);

// =====================================================================
// التقسيم حسب الشركات + حذف الأعمدة + كاتب ZIP
// =====================================================================
const { filterDeletedColumns, sliceOwnColumns, planSplit, mergeSlices, crc32, buildZip } = require("./app.js");

// --- planSplit: توزيع تسلسلي عبر شركتين + حساب المتبقي
const fA = { name: "A.csv", hasHeader: true, headers: ["x"], dataRows: [["a1"], ["a2"], ["a3"], ["a4"], ["a5"]] };
const fB = { name: "B.csv", hasHeader: true, headers: ["y"], dataRows: [["b1"], ["b2"], ["b3"]] };
const sp = planSplit([fA, fB], [
  { name: "c1", merge: false, counts: [2, 1] },
  { name: "c2", merge: false, counts: [2, 0] },
]);
check("split c1 takes first 2 of A", sp.companies[0].slices.find((s) => s.fileIndex === 0).rows.map((r) => r[0]).join(",") === "a1,a2", sp.companies[0].slices);
check("split c1 takes first 1 of B", sp.companies[0].slices.find((s) => s.fileIndex === 1).rows.map((r) => r[0]).join(",") === "b1", sp.companies[0].slices);
check("split c2 takes next 2 of A", sp.companies[1].slices.find((s) => s.fileIndex === 0).rows.map((r) => r[0]).join(",") === "a3,a4", sp.companies[1].slices);
check("split c2 takes none of B", !sp.companies[1].slices.some((s) => s.fileIndex === 1), sp.companies[1].slices);
const remA = sp.remainder.find((s) => s.fileIndex === 0);
const remB = sp.remainder.find((s) => s.fileIndex === 1);
check("split remainder A = a5", remA && remA.rows.map((r) => r[0]).join(",") === "a5", remA);
check("split remainder B = b2,b3", remB && remB.rows.map((r) => r[0]).join(",") === "b2,b3", remB);

// --- planSplit: قصّ الطلب الزائد على المتاح
const cl = planSplit([fA], [{ name: "big", merge: false, counts: [10] }]);
check("split clamps over-allocation to 5", cl.companies[0].slices[0].rows.length === 5, cl.companies[0].slices[0].rows.length);
check("split clamp leaves no remainder", cl.remainder.length === 0, cl.remainder);
const cl2 = planSplit([fA], [
  { name: "c1", merge: false, counts: [4] },
  { name: "c2", merge: false, counts: [4] },
]);
check("split sequential clamp: c1 gets 4", cl2.companies[0].slices[0].rows.length === 4, cl2.companies[0].slices[0].rows.length);
check("split sequential clamp: c2 gets remaining 1", cl2.companies[1].slices[0].rows.length === 1, cl2.companies[1].slices[0].rows.length);
check("split sequential clamp: nothing left", cl2.remainder.length === 0, cl2.remainder);

// --- mergeSlices: ناتج الشركة المدموجة يطابق دمج الشرائح عبر mergeWithMaps
const planForSplit = autoMergePlan([a1, a2], opts);
const spM = planSplit([a1, a2], [{ name: "co", merge: true, counts: [3, 2] }]);
const mergedCo = mergeSlices([a1, a2], opts, planForSplit, spM.companies[0].slices);
const pf1 = Object.assign({}, a1, { dataRows: a1.dataRows.slice(0, 3), empty: false });
const pf2 = Object.assign({}, a2, { dataRows: a2.dataRows.slice(0, 2), empty: false });
const expectedCo = mergeWithMaps([pf1, pf2], opts, planForSplit);
check("merged-company headers match mergeWithMaps", mergedCo.headers.join("|") === expectedCo.headers.join("|"), mergedCo.headers);
check("merged-company rows match mergeWithMaps", JSON.stringify(mergedCo.rows) === JSON.stringify(expectedCo.rows), [mergedCo.rows.length, expectedCo.rows.length]);
check("merged-company row total = 3+2", mergedCo.rows.length === 5, mergedCo.rows.length);

// --- sliceOwnColumns: الإخراج غير المدموج يحافظ على أعمدة الملف، والملف بلا رأس يبقى بلا رأس
const own1 = sliceOwnColumns(a1, a1.dataRows.slice(0, 2), new Set());
check("unmerged named keeps own headers", own1.headers.join("|") === a1.headers.join("|"), own1.headers);
check("unmerged named row shape preserved", own1.rows.length === 2 && own1.rows[0].length === a1.headers.length, own1.rows[0]);
const ownHl = sliceOwnColumns(hl1, hl1.dataRows, new Set());
check("unmerged headerless has null headers", ownHl.headers === null, ownHl.headers);
check("unmerged headerless keeps all columns", ownHl.rows[0].length === hl1.headers.length, ownHl.rows[0]);

// --- حذف الأعمدة يُستبعد من المخرجات (المدموج وغير المدموج)
const planDel = autoMergePlan([a1, a2], opts); // 5 أعمدة، آخرها "الهاتف"
const delKey = planDel.finalCols[planDel.finalCols.length - 1];
const filtered = filterDeletedColumns(planDel, new Set([delKey]));
check("filterDeletedColumns drops header", !filtered.headers.includes("الهاتف") && filtered.headers.length === 4, filtered.headers);
check("filterDeletedColumns shrinks every map", filtered.maps[0].length === 4 && filtered.maps[1].length === 4, filtered.maps.map((m) => m.length));
const mergedDel = mergeWithMaps([a1, a2], opts, filtered);
check("deleted column absent from merged output", !mergedDel.headers.includes("الهاتف") && mergedDel.rows[0].length === 4, mergedDel.headers);
const ownDel = sliceOwnColumns(a1, a1.dataRows.slice(0, 2), new Set([1])); // احذف العمود 1 (البريد)
check("unmerged excludes deleted source column", ownDel.headers.join("|") === "الاسم|المدينة|العمر" && ownDel.rows[0].length === 3, ownDel.headers);

// --- crc32: متجه معروف
const crcIn = Uint8Array.from("123456789", (c) => c.charCodeAt(0));
check("crc32(\"123456789\") === 0xCBF43926", crc32(crcIn) === 0xcbf43926, crc32(crcIn).toString(16));

// --- بنية ZIP: التواقيع + العلم UTF-8 + عدد السجلات
const zEnc = new TextEncoder();
const zEntries = [
  { name: "شركة/merged.csv", data: zEnc.encode("a,b\r\n1,2") },
  { name: "المتبقي/A.csv", data: zEnc.encode("x") },
];
const zip = buildZip(zEntries);
check("zip starts with local header PK\\x03\\x04", zip[0] === 0x50 && zip[1] === 0x4b && zip[2] === 0x03 && zip[3] === 0x04, [zip[0], zip[1], zip[2], zip[3]]);
check("zip local header sets UTF-8 flag (0x0800)", zip[6] === 0x00 && zip[7] === 0x08, [zip[6], zip[7]]);
function findSig(buf, a, b, c, d) {
  for (let i = buf.length - 4; i >= 0; i--) if (buf[i] === a && buf[i + 1] === b && buf[i + 2] === c && buf[i + 3] === d) return i;
  return -1;
}
const centralAt = findSig(zip, 0x50, 0x4b, 0x01, 0x02);
check("zip contains central directory signature PK\\x01\\x02", centralAt >= 0, centralAt);
const eocdAt = findSig(zip, 0x50, 0x4b, 0x05, 0x06);
check("zip contains EOCD signature PK\\x05\\x06", eocdAt >= 0, eocdAt);
const totalEntries = zip[eocdAt + 10] | (zip[eocdAt + 11] << 8);
const diskEntries = zip[eocdAt + 8] | (zip[eocdAt + 9] << 8);
check("zip EOCD total entry count matches", totalEntries === zEntries.length, totalEntries);
check("zip EOCD disk entry count matches", diskEntries === zEntries.length, diskEntries);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
