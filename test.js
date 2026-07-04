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

// =====================================================================
// دعم Excel (.xlsx): قارئ ZIP + تحليل XML + التواريخ + التكامل مع المسار الحالي
// كل العيّنات تُبنى داخل الاختبار عبر buildZip (STORE) + سلاسل XML مكتوبة يدويًا.
// =====================================================================
const {
  parseXlsx, parseZipEntries, parseSharedStrings, parseSheet, parseStyles,
  colRefToIndex, classifyNumFmt, excelSerialToText, decodeXml, trimTrailingEmpty,
  xlsxSheetsToFiles, analyzeRows,
} = require("./app.js");
const zlib = require("zlib");

const XENC = new TextEncoder();

// يبني خريطة ملفات مصنّف قياسية (workbook + rels + أوراق + اختياريًا sharedStrings/styles)
function workbookFiles(sheets, extra) {
  extra = extra || {};
  const files = {};
  const sheetEls = sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  const wbPr = extra.date1904 ? `<workbookPr date1904="1"/>` : "";
  files["xl/workbook.xml"] =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    wbPr + `<sheets>` + sheetEls + `</sheets></workbook>`;
  const relEls = sheets.map((s, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  files["xl/_rels/workbook.xml.rels"] =
    `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` + relEls + `</Relationships>`;
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = s.xml; });
  if (extra.sharedStrings != null) files["xl/sharedStrings.xml"] = extra.sharedStrings;
  if (extra.styles != null) files["xl/styles.xml"] = extra.styles;
  return files;
}
function filesToEntries(files) {
  return Object.keys(files).map((name) => ({ name, data: XENC.encode(files[name]) }));
}
function buildWorkbook(sheets, extra) { return buildZip(filesToEntries(workbookFiles(sheets, extra))); }
function wsheet(rowsXml) {
  return `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowsXml}</sheetData></worksheet>`;
}
function sst(items) {
  return `<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    items.map((it) => `<si>${it}</si>`).join("") + `</sst>`;
}
// كاتب ZIP بطريقة DEFLATE (لاختبار مسار فكّ الضغط في القارئ) — يعيد استخدام crc32 المُصدَّر
function buildZipDeflate(entries) {
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => { n = n >>> 0; return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; };
  const local = [], central = [];
  let offset = 0;
  entries.forEach((e) => {
    const nameBytes = XENC.encode(e.name);
    const comp = new Uint8Array(zlib.deflateRawSync(Buffer.from(e.data)));
    const crc = crc32(e.data);
    const lh = [].concat(u32(0x04034b50), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21),
      u32(crc), u32(comp.length), u32(e.data.length), u16(nameBytes.length), u16(0));
    const lhArr = Uint8Array.from(lh);
    local.push(lhArr, nameBytes, comp);
    const localOffset = offset; offset += lhArr.length + nameBytes.length + comp.length;
    const ch = [].concat(u32(0x02014b50), u16(20), u16(20), u16(0x0800), u16(8), u16(0), u16(0x21),
      u32(crc), u32(comp.length), u32(e.data.length), u16(nameBytes.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(localOffset));
    central.push(Uint8Array.from(ch), nameBytes);
  });
  let centralSize = 0; central.forEach((p) => { centralSize += p.length; });
  const centralOffset = offset;
  const eocd = [].concat(u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralSize), u32(centralOffset), u16(0));
  const eocdArr = Uint8Array.from(eocd);
  const out = new Uint8Array(offset + centralSize + eocdArr.length);
  let pos = 0;
  local.forEach((p) => { out.set(p, pos); pos += p.length; });
  central.forEach((p) => { out.set(p, pos); pos += p.length; });
  out.set(eocdArr, pos);
  return out;
}

async function runExcelTests() {
  // --- colRefToIndex
  check("colRef A→0", colRefToIndex("A") === 0);
  check("colRef Z→25", colRefToIndex("Z") === 25);
  check("colRef AA→26", colRefToIndex("AA") === 26);
  check("colRef AB→27", colRefToIndex("AB") === 27);
  check("colRef strips row (C5→2)", colRefToIndex("C5") === 2);

  // --- classifyNumFmt: builtins + custom
  check("numFmt 14 builtin date", classifyNumFmt(14, null) === "date");
  check("numFmt 22 builtin datetime", classifyNumFmt(22, null) === "datetime");
  check("numFmt 21 builtin time", classifyNumFmt(21, null) === "time");
  check("numFmt 47 builtin time", classifyNumFmt(47, null) === "time");
  check("numFmt 0 general → null", classifyNumFmt(0, null) === null);
  check("numFmt 2 numeric → null", classifyNumFmt(2, "0.00") === null);
  check("custom date code", classifyNumFmt(164, "yyyy-mm-dd") === "date");
  check("custom datetime code", classifyNumFmt(165, "yyyy-mm-dd hh:mm:ss") === "datetime");
  check("custom time code (h+mm)", classifyNumFmt(166, "h:mm") === "time");
  check("custom month name → date", classifyNumFmt(167, "mmm-yy") === "date");
  check("custom with literal + entities → date", classifyNumFmt(168, '"التاريخ "yyyy-mm-dd') === "date");

  // --- excelSerialToText (1900 + 1904 + fractions)
  check("serial→date 44197=2021-01-01", excelSerialToText(44197, "date", false) === "2021-01-01", excelSerialToText(44197, "date", false));
  check("serial→datetime .5 = noon", excelSerialToText(44197.5, "datetime", false) === "2021-01-01 12:00:00", excelSerialToText(44197.5, "datetime", false));
  check("serial→time 0.75 = 18:00:00", excelSerialToText(0.75, "time", false) === "18:00:00", excelSerialToText(0.75, "time", false));
  check("serial→date 1904 (42735=2021-01-01)", excelSerialToText(42735, "date", true) === "2021-01-01", excelSerialToText(42735, "date", true));

  // --- decodeXml
  check("decodeXml entities", decodeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;") === 'a & b <c> "d" \'e\'', decodeXml("a &amp; b &lt;c&gt;"));
  check("decodeXml numeric", decodeXml("&#65;&#x42;") === "AB", decodeXml("&#65;&#x42;"));

  // --- parseSharedStrings: simple + rich runs + entity
  const ss = parseSharedStrings(sst(["<t>hello</t>", "<r><t>a &amp; </t></r><r><t>b</t></r>", "<t xml:space=\"preserve\"> x </t>"]));
  check("sst simple", ss[0] === "hello", ss);
  check("sst rich-text runs concatenated", ss[1] === "a & b", ss);
  check("sst preserve space", ss[2] === " x ", JSON.stringify(ss[2]));

  // --- parseZipEntries: round-trip a STORE zip built by buildZip
  const rtZip = buildZip([{ name: "أ/ملف.txt", data: XENC.encode("محتوى 1") }, { name: "b.bin", data: Uint8Array.from([1, 2, 3, 255]) }]);
  const rtEntries = await parseZipEntries(rtZip);
  check("zip reader round-trips names", rtEntries.map((e) => e.name).join("|") === "أ/ملف.txt|b.bin", rtEntries.map((e) => e.name));
  check("zip reader round-trips STORE data", new TextDecoder().decode(rtEntries[0].data) === "محتوى 1" && rtEntries[1].data[3] === 255, rtEntries[1].data);

  // --- comprehensive sheet: shared str, inlineStr, gap fill, number, boolean, error, formula(str+num), entity
  const compSheet = wsheet(
    `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="inlineStr"><is><t>سطر &amp; مضمّن</t></is></c></row>` +
    `<row r="2"><c r="A2"><v>42</v></c><c r="B2" t="b"><v>1</v></c><c r="C2" t="e"><v>#DIV/0!</v></c></row>` +
    `<row r="3"><c r="A3" t="str"><f>X()</f><v>ناتج صيغة</v></c><c r="B3"><f>SUM(A1:A2)</f><v>42</v></c><c r="C3" t="s"><v>1</v></c></row>`
  );
  const compWb = buildWorkbook([{ name: "Main", xml: compSheet }], { sharedStrings: sst(["<t>مرحبا</t>", "<t>a &amp; b</t>"]) });
  const compSheets = await parseXlsx(compWb);
  const cr = compSheets[0].rows;
  check("xlsx shared string value", cr[0][0] === "مرحبا", cr[0]);
  check("xlsx column gap filled empty (B1)", cr[0][1] === "", cr[0]);
  check("xlsx inlineStr + entity", cr[0][2] === "سطر & مضمّن", cr[0]);
  check("xlsx number cell", cr[1][0] === "42", cr[1]);
  check("xlsx boolean → TRUE", cr[1][1] === "TRUE", cr[1]);
  check("xlsx error cell → empty", cr[1][2] === "", cr[1]);
  check("xlsx formula cached string", cr[2][0] === "ناتج صيغة", cr[2]);
  check("xlsx numeric formula cached value", cr[2][1] === "42", cr[2]);
  check("xlsx shared string entity decoded", cr[2][2] === "a & b", cr[2]);

  // --- DEFLATE path: same workbook compressed with deflate-raw
  const compWbDeflate = buildZipDeflate(filesToEntries(workbookFiles([{ name: "Main", xml: compSheet }], { sharedStrings: sst(["<t>مرحبا</t>", "<t>a &amp; b</t>"]) })));
  const dfSheets = await parseXlsx(compWbDeflate);
  check("xlsx DEFLATE entries decode", dfSheets[0].rows[0][0] === "مرحبا" && dfSheets[0].rows[2][2] === "a & b", dfSheets[0].rows);

  // --- dates via styles (builtin + custom datetime + builtin time), non-date numeric stays number
  const styleXml = `<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd hh:mm:ss"/></numFmts>` +
    `<cellXfs count="4"><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="164"/><xf numFmtId="21"/></cellXfs></styleSheet>`;
  const dateSheet = wsheet(
    `<row r="1"><c r="A1" s="1"><v>44197</v></c><c r="B1" s="2"><v>44197.5</v></c><c r="C1" s="3"><v>0.75</v></c><c r="D1" s="0"><v>44197</v></c></row>`
  );
  const dateWb = buildWorkbook([{ name: "Dates", xml: dateSheet }], { styles: styleXml });
  const dateRows = (await parseXlsx(dateWb))[0].rows;
  check("xlsx builtin date (14)", dateRows[0][0] === "2021-01-01", dateRows[0]);
  check("xlsx custom datetime (164)", dateRows[0][1] === "2021-01-01 12:00:00", dateRows[0]);
  check("xlsx builtin time (21)", dateRows[0][2] === "18:00:00", dateRows[0]);
  check("xlsx unstyled number stays numeric", dateRows[0][3] === "44197", dateRows[0]);

  // --- date1904 offset applied through the pipeline
  const wb1904 = buildWorkbook([{ name: "D1904", xml: wsheet(`<row r="1"><c r="A1" s="1"><v>42735</v></c></row>`) }], { styles: styleXml, date1904: true });
  const rows1904 = (await parseXlsx(wb1904))[0].rows;
  check("xlsx date1904 offset", rows1904[0][0] === "2021-01-01", rows1904[0]);

  // --- trailing empty row/column trimming
  const trimSheet = wsheet(
    `<row r="1"><c r="A1" t="inlineStr"><is><t>x</t></is></c><c r="B1" t="inlineStr"><is><t></t></is></c></row>` +
    `<row r="2"><c r="A2" t="inlineStr"><is><t>y</t></is></c></row>` +
    `<row r="3"><c r="A3" t="inlineStr"><is><t></t></is></c></row>`
  );
  const trimRows = (await parseXlsx(buildWorkbook([{ name: "Trim", xml: trimSheet }])))[0].rows;
  check("xlsx trims trailing empty rows", trimRows.length === 2, trimRows.length);
  check("xlsx trims trailing empty cols", trimRows[0].length === 1 && trimRows[0][0] === "x", trimRows[0]);
  // parseSheet direct trim check
  const directTrim = trimTrailingEmpty([["a", "", ""], ["b", "", ""], ["", "", ""]]);
  check("trimTrailingEmpty direct", directTrim.length === 2 && directTrim[0].length === 1, directTrim);

  // --- multi-sheet naming + empty-sheet skipping
  const multiWb = buildWorkbook([
    { name: "بيانات", xml: wsheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>ا</t></is></c></row>`) },
    { name: "فارغة", xml: wsheet(``) },
    { name: "أخرى", xml: wsheet(`<row r="1"><c r="A1" t="inlineStr"><is><t>ب</t></is></c></row>`) },
  ]);
  const multiSheets = await parseXlsx(multiWb);
  check("xlsx returns all sheets incl empty", multiSheets.length === 3 && multiSheets[1].rows.length === 0, multiSheets.map((s) => s.rows.length));
  const multiFiles = xlsxSheetsToFiles("كتاب.xlsx", multiSheets);
  check("multi-sheet skips empty sheet", multiFiles.length === 2, multiFiles.map((f) => f.name));
  check("multi-sheet naming uses — SheetName", multiFiles[0].name === "كتاب.xlsx — بيانات" && multiFiles[1].name === "كتاب.xlsx — أخرى", multiFiles.map((f) => f.name));
  const oneFiles = xlsxSheetsToFiles("وحيد.xlsx", [{ sheetName: "Sheet1", rows: [["v"]] }]);
  check("single non-empty sheet named after file", oneFiles.length === 1 && oneFiles[0].name === "وحيد.xlsx", oneFiles);

  // --- .xls (OLE2) rejection
  let oleErr = null;
  try { await parseXlsx(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0, 0])); } catch (e) { oleErr = e; }
  check(".xls OLE2 rejected with code", oleErr && oleErr.code === "OLE2", oleErr && oleErr.code);
  check(".xls OLE2 arabic message", oleErr && oleErr.arMessage.includes("غير مدعومة") && oleErr.arMessage.includes("xlsx"), oleErr && oleErr.arMessage);

  // --- corrupt zip / non-xlsx rejection
  let badErr = null;
  try { await parseXlsx(Uint8Array.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7, 8])); } catch (e) { badErr = e; }
  check("corrupt zip rejected (BADXLSX)", badErr && badErr.code === "BADXLSX", badErr && badErr.code);
  let notZip = null;
  try { await parseXlsx(XENC.encode("just some text, not a zip")); } catch (e) { notZip = e; }
  check("non-xlsx bytes rejected", notZip && notZip.code === "BADXLSX", notZip && notZip.code);
  let zipErr = null;
  try { await parseZipEntries(Uint8Array.from([1, 2, 3, 4, 5])); } catch (e) { zipErr = e; }
  check("parseZipEntries throws on garbage", zipErr && zipErr.code === "BADZIP", zipErr && zipErr.code);

  // --- End-to-end: parse xlsx → analyzeRows → merge with a CSV file
  const e2eXlsx = buildWorkbook([{
    name: "عملاء", xml: wsheet(
      `<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>30</v></c></row>` +
      `<row r="3"><c r="A3" t="s"><v>3</v></c><c r="B3"><v>25</v></c></row>`),
  }], { sharedStrings: sst(["<t>الاسم</t>", "<t>العمر</t>", "<t>أحمد</t>", "<t>سارة</t>"]) });
  const e2eSheets = await parseXlsx(e2eXlsx);
  const xa = analyzeRows("عملاء.xlsx", e2eSheets[0].rows, opts, null, { excel: { sheetName: "عملاء" } });
  check("excel analyzeRows detects header", xa.hasHeader === true && xa.headers.join("|") === "الاسم|العمر", xa.headers);
  check("excel analyzeRows data rows", xa.dataRows.length === 2 && xa.dataRows[0].join("|") === "أحمد|30", xa.dataRows);
  check("excel analyzed carries excel meta, no delimiter", xa.excel && xa.excel.sheetName === "عملاء" && xa.delimiter === null, [xa.excel, xa.delimiter]);
  const csvB = analyzeFile("more.csv", "الاسم,العمر\nخالد,40\n", opts);
  const e2eMerge = buildMerge([xa, csvB], opts);
  check("excel+csv merge headers", e2eMerge.headers.join("|") === "الاسم|العمر", e2eMerge.headers);
  check("excel+csv merge row total", e2eMerge.rows.length === 3, e2eMerge.rows.length);
  const khaled = e2eMerge.rows.find((r) => r[0] === "خالد");
  const ahmed = e2eMerge.rows.find((r) => r[0] === "أحمد");
  check("excel+csv merged values aligned", khaled && khaled[1] === "40" && ahmed && ahmed[1] === "30", [khaled, ahmed]);

  // --- delimiter cross-check must NOT fire against Excel files
  const csvSemi = analyzeFile("semi.csv", "الاسم;العمر\nع;5\n", opts);
  const crossExcel = crossFileChecks([xa, csvSemi], opts);
  check("no delimiter diff issue when one side is Excel", !crossExcel.some((i) => i.message.includes("فواصل مختلفة")), crossExcel.map((i) => i.message));
  const csvComma = analyzeFile("comma.csv", "الاسم,العمر\nع,5\n", opts);
  const crossCsv = crossFileChecks([csvComma, csvSemi], opts);
  check("delimiter diff DOES fire between two CSVs", crossCsv.some((i) => i.message.includes("فواصل مختلفة")), crossCsv.map((i) => i.message));

  // --- split / ZIP export including an Excel-sourced category
  const splitPlan = autoMergePlan([xa, csvB], opts);
  const sp2 = planSplit([xa, csvB], [{ name: "شركة أ", merge: true, counts: [2, 1] }]);
  check("split takes 2 rows from Excel category", sp2.companies[0].slices.find((s) => s.fileIndex === 0).rows.length === 2, sp2.companies[0].slices);
  const coMerged = mergeSlices([xa, csvB], opts, splitPlan, sp2.companies[0].slices);
  check("split merged company row total (2 excel + 1 csv)", coMerged.rows.length === 3, coMerged.rows.length);
  const splitZip = buildZip([{ name: "شركة أ/merged.csv", data: XENC.encode(toCSV(coMerged.includeHeader ? coMerged.headers : null, coMerged.rows, ",")) }]);
  check("split ZIP with Excel category is valid", splitZip[0] === 0x50 && splitZip[1] === 0x4b && splitZip[6] === 0x00 && splitZip[7] === 0x08, [splitZip[0], splitZip[1]]);
  const splitBack = await parseZipEntries(splitZip);
  check("split ZIP entry readable back", splitBack.length === 1 && new TextDecoder().decode(splitBack[0].data).includes("أحمد"), splitBack.length);
}

// --- csvEntryName: أسماء ملفات الأرشيف تُجبر دائمًا على الامتداد .csv
{
  const { csvEntryName } = require("./app.js");
  check("csvEntryName keeps csv", csvEntryName("عملاء.csv") === "عملاء.csv", csvEntryName("عملاء.csv"));
  check("csvEntryName xlsx -> csv", csvEntryName("45.xlsx") === "45.csv", csvEntryName("45.xlsx"));
  check("csvEntryName xlsm -> csv", csvEntryName("ماكرو.XLSM") === "ماكرو.csv", csvEntryName("ماكرو.XLSM"));
  check("csvEntryName txt -> csv", csvEntryName("بيانات.txt") === "بيانات.csv", csvEntryName("بيانات.txt"));
  check("csvEntryName sheet-suffixed xlsx", csvEntryName("كتاب.xlsx — بيانات") === "كتاب — بيانات.csv", csvEntryName("كتاب.xlsx — بيانات"));
  check("csvEntryName strips illegal chars", csvEntryName('a/b\\c:d*e?f"g<h>i|j.xlsx') === "a-b-c-d-e-f-g-h-i-j.csv", csvEntryName('a/b\\c:d*e?f"g<h>i|j.xlsx'));
  check("csvEntryName no extension", csvEntryName("بدون امتداد") === "بدون امتداد.csv", csvEntryName("بدون امتداد"));
  check("csvEntryName empty fallback", csvEntryName("") === "ملف.csv", csvEntryName(""));
  check("csvEntryName dot not extension kept", csvEntryName("v1.2-تقرير") === "v1.2-تقرير.csv", csvEntryName("v1.2-تقرير"));
}

runExcelTests().then(() => {
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}).catch((e) => {
  failed++;
  console.log("FAIL: Excel test suite crashed | " + (e && e.stack ? e.stack : e));
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(1);
});
