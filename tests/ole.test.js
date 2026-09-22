"use strict";
// قارئ OLE2/CFB: ملف مشفّر حقيقي من msoffcrypto (مقارنةً بما يقرؤه olefile) + ملفات صناعية (إصدار 3/4، DIFAT، ملفات تالفة)
const fs = require("fs");
const path = require("path");
const nodeCrypto = require("crypto");
const { isOle, readOle, getStream } = require("../js/core/ole.js");
const { buildCfb, FREESECT } = require("./fixtures/cfb-writer.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });

const FIX = path.join(__dirname, "fixtures");
const sha256 = (b) => nodeCrypto.createHash("sha256").update(b).digest("hex");
const sameBytes = (a, b) => !!a && !!b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
function pattern(n, seed) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + seed + (i >> 9)) & 255; // (i >> 9) يميّز القطاعات عن بعضها
  return out;
}

// يعيد الخطأ المرمي (أو null)
function thrown(fn) { try { fn(); return null; } catch (e) { return e; } }
function expectBadOle(name, bytes) {
  const e = thrown(() => readOle(bytes));
  check(name + " → BADOLE", !!e && e.code === "BADOLE" && /[ء-ي]/.test(e.arMessage || ""), e && { code: e.code, msg: e.message });
}

/* ---------- isOle ---------- */
const encrypted = new Uint8Array(fs.readFileSync(path.join(FIX, "encrypted-agile.xlsx")));
const plain = new Uint8Array(fs.readFileSync(path.join(FIX, "plain.xlsx")));
check("isOle: msoffcrypto encrypted file", isOle(encrypted));
check("isOle: plain .xlsx (ZIP) is not OLE", !isOle(plain));
check("isOle: empty bytes", !isOle(new Uint8Array(0)));
check("isOle: signature prefix only (4 bytes)", !isOle(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0])));
check("isOle: accepts ArrayBuffer", isOle(encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + 16)));

/* ---------- ملف msoffcrypto الحقيقي مقابل olefile ---------- */
{
  const manifest = JSON.parse(fs.readFileSync(path.join(FIX, "encrypted-agile.streams.json"), "utf8"));
  const ole = readOle(encrypted);
  const want = Object.keys(manifest.streams).sort();
  const got = Array.from(ole.streams.keys()).sort();
  eq("fixture: same stream paths as olefile (incl. nested \\x06DataSpaces)", JSON.stringify(got), JSON.stringify(want));
  check("fixture: EncryptionInfo lives in the mini stream (exercises mini FAT)", manifest.streams.EncryptionInfo.mini === true);
  check("fixture: EncryptedPackage lives in regular sectors", manifest.streams.EncryptedPackage.mini === false);
  want.forEach((k) => {
    const s = ole.streams.get(k);
    check(`fixture stream ${JSON.stringify(k)} size + sha256 match olefile`,
      !!s && s.length === manifest.streams[k].size && sha256(s) === manifest.streams[k].sha256,
      s ? { size: s.length } : "missing");
  });
  check("getStream is case-insensitive", sameBytes(getStream(ole, "encryptioninfo"), ole.streams.get("EncryptionInfo")));
  check("getStream exact name", getStream(ole, "EncryptedPackage") === ole.streams.get("EncryptedPackage"));
  eq("getStream missing → null", getStream(ole, "Workbook"), null);
  check("getStream does not match nested stream by leaf name", getStream(ole, "Version") === null);
}

/* ---------- ملفات صناعية: الإصدار 3 و4 ---------- */
function sampleEntries() {
  return [
    { name: "Workbook", data: pattern(10000, 1) },
    { name: "Small", data: pattern(100, 2) },
    { name: "Empty", data: new Uint8Array(0) },
    { name: "Exactly4096", data: pattern(4096, 3) },  // = الحد ← قطاعات عادية
    { name: "Just4095", data: pattern(4095, 4) },     // أقل من الحد ← التيار المصغّر
    { name: "\u0005SummaryInformation", data: pattern(200, 5) },
    { name: "Store", children: [
      { name: "Inner", data: pattern(70, 6) },
      { name: "Deep", children: [{ name: "Leaf", data: pattern(5000, 7) }] },
    ] },
  ];
}
function expectedStreams() {
  return {
    "Workbook": pattern(10000, 1), "Small": pattern(100, 2), "Empty": new Uint8Array(0),
    "Exactly4096": pattern(4096, 3), "Just4095": pattern(4095, 4), "\u0005SummaryInformation": pattern(200, 5),
    "Store/Inner": pattern(70, 6), "Store/Deep/Leaf": pattern(5000, 7),
  };
}
function checkAllStreams(label, bytes) {
  const e = thrown(() => readOle(bytes));
  if (e) { check(label + ": readOle succeeds", false, e.message); return; }
  const ole = readOle(bytes);
  const want = expectedStreams();
  eq(label + ": stream count", ole.streams.size, Object.keys(want).length);
  Object.keys(want).forEach((k) => check(`${label}: ${JSON.stringify(k)} content`, sameBytes(ole.streams.get(k), want[k])));
}

const v3 = buildCfb({ version: 3, entries: sampleEntries() });
eq("v3 builder uses 512-byte sectors", v3.sectorSize, 512);
checkAllStreams("v3", v3.bytes);
const v4 = buildCfb({ version: 4, entries: sampleEntries() });
eq("v4 builder uses 4096-byte sectors", v4.sectorSize, 4096);
checkAllStreams("v4", v4.bytes);

// أكثر من 109 قطاع FAT ← مواقع البقية في سلسلة قطاعات DIFAT
const difat = buildCfb({ version: 3, entries: sampleEntries(), minFatSectors: 240 });
check("DIFAT builder produced 2 extra DIFAT sectors", difat.difatSectors.length === 2, difat.difatSectors);
checkAllStreams("v3 + extra DIFAT sectors", difat.bytes);
{
  // تيار كبير تقع سلسلته في قطاعات يغطيها قطاع FAT الموجود في DIFAT الإضافي فقط
  const perSector = 128;
  const big = pattern(perSector * 512 * 112, 9); // ~7 MB ← يحتاج أكثر من 109 قطاع FAT
  const b = buildCfb({ version: 3, entries: [{ name: "Big", data: big }] });
  check("large file needs extra DIFAT sectors", b.difatSectors.length >= 1, b.fatSectors.length);
  const s = thrown(() => readOle(b.bytes)) || readOle(b.bytes).streams.get("Big");
  check("large stream read via FAT sectors listed in extra DIFAT", sameBytes(s, big), s && s.message);
}

// الإصدار 3: تجاهل الـ 32 بت العليا من حجم التيار
checkAllStreams("v3 with garbage in high dword of stream size", buildCfb({ version: 3, entries: sampleEntries(), sizeHighGarbage: true }).bytes);

// آخر قطاع ناقص (حجم الملف ليس من مضاعفات 512) — بعض الكتّاب ينتجون ذلك؛ نكمله بأصفار
checkAllStreams("v3 with truncated final (FAT) sector", v3.bytes.subarray(0, v3.bytes.length - 100));

/* ---------- ملفات تالفة ← BADOLE (بلا حلقات لا نهائية) ---------- */
function corrupt(mutate) {
  const b = buildCfb({ version: 3, entries: sampleEntries() });
  const copy = b.bytes.slice();
  mutate(b, new DataView(copy.buffer), copy);
  return copy;
}
// setFat يكتب في نسخة الكاتب نفسه؛ نستخدم البايتات الأصلية بعد التعديل
function corruptFat(streamPath, value) {
  const b = buildCfb({ version: 3, entries: sampleEntries() });
  b.setFat(b.streamStart[streamPath], value === "self" ? b.streamStart[streamPath] : value);
  return b.bytes;
}
expectBadOle("FAT chain loop (sector points to itself)", corruptFat("Workbook", "self"));
expectBadOle("FAT chain to out-of-range sector", corruptFat("Workbook", 999999));
expectBadOle("FAT chain hits FREESECT before stream end", corruptFat("Workbook", FREESECT));
expectBadOle("truncated file (half)", v3.bytes.subarray(0, v3.bytes.length >> 1));
expectBadOle("header only (100 bytes)", v3.bytes.subarray(0, 100));
expectBadOle("not an OLE signature", plain);
expectBadOle("bad byte-order mark", corrupt((b, dv) => dv.setUint16(28, 0xfeff, true)));
expectBadOle("unsupported sector shift", corrupt((b, dv) => dv.setUint16(30, 10, true)));
expectBadOle("FAT sector count larger than file", corrupt((b, dv) => dv.setUint32(44, 100000, true)));
const dirEntry = (b, i) => (b.firstDir + 1) * b.sectorSize + i * 128;
expectBadOle("directory sibling cycle", corrupt((b, dv) => dv.setUint32(dirEntry(b, 1) + 68, 1, true)));
expectBadOle("directory child index out of range", corrupt((b, dv) => dv.setUint32(dirEntry(b, 0) + 76, 5000, true)));
expectBadOle("root entry has wrong type", corrupt((b, dv, bytes) => { bytes[dirEntry(b, 0) + 66] = 1; }));
expectBadOle("mini stream start sector out of range", corrupt((b, dv) => dv.setUint32(dirEntry(b, 2) + 116, 100000, true)));
expectBadOle("stream size larger than its chain", corrupt((b, dv) => dv.setUint32(dirEntry(b, 1) + 120, 20000, true)));
expectBadOle("mini stream size larger than its chain", corrupt((b, dv) => dv.setUint32(dirEntry(b, 2) + 120, 3000, true)));

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
