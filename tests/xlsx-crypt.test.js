"use strict";
// فك تشفير ملفات Excel المحمية بكلمة سر (Agile) — مقارنةً بناتج msoffcrypto وبالملف الأصلي قبل التشفير
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const X = require("../js/core/xlsx-crypt.js");
const { parseXlsx } = require("../js/core/xlsx.js");
const { readOle } = require("../js/core/ole.js");
const { buildCfb } = require("./fixtures/cfb-writer.js");

let passed = 0, failed = 0;
function check(name, cond, extra) {
  if (cond) { passed++; console.log("PASS: " + name); }
  else { failed++; console.log("FAIL: " + name + (extra !== undefined ? " | " + JSON.stringify(extra) : "")); }
}
const eq = (name, got, want) => check(name, got === want, { got, want });
const same = (name, got, want) => eq(name, JSON.stringify(got), JSON.stringify(want));

const FIX = path.join(__dirname, "fixtures");
const load = (f) => new Uint8Array(fs.readFileSync(path.join(FIX, f)));
const sameBytes = (a, b) => !!a && !!b && a.length === b.length && Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
const thrown = (fn) => { try { fn(); return null; } catch (e) { return e; } };
function expectCode(name, fn, code) {
  const e = thrown(fn);
  check(`${name} → ${code}`, !!e && e.code === code && /[ء-ي]/.test(e.arMessage || ""), e ? { code: e.code, msg: e.message } : "no error");
  return e;
}

const PASSWORD = "Tamim-123";
const PASSWORD_AR = "سرّي-Tamim-٤٥٦";
const encrypted = load("encrypted-agile.xlsx");
const encryptedAr = load("encrypted-agile-ar.xlsx");
const plain = load("plain.xlsx");
const msoffDecrypted = load("encrypted-agile.decrypted.xlsx");

/* ---------- ملفات OLE صناعية لبقية الأنواع ---------- */
const le = (major, minor, flags) => Uint8Array.from([major, 0, minor, 0, flags & 0xff, (flags >>> 8) & 0xff, 0, 0]);
function withHeader(header, rest) {
  const out = new Uint8Array(header.length + rest.length);
  out.set(header); out.set(rest, header.length);
  return out;
}
const fakePackage = new Uint8Array(5000);
const encOle = (major, minor, flags, names) => buildCfb({ version: 3, entries: [
  { name: (names && names[0]) || "EncryptionInfo", data: withHeader(le(major, minor, flags), new Uint8Array(200)) },
  { name: (names && names[1]) || "EncryptedPackage", data: fakePackage },
] }).bytes;
const standard32 = encOle(3, 2, 0x24);
const standard42 = encOle(4, 2, 0x24);
const extensible = encOle(4, 3, 0x0c);
const legacyXls = buildCfb({ version: 3, entries: [
  { name: "Workbook", data: new Uint8Array(6000) },
  { name: "\u0005SummaryInformation", data: new Uint8Array(300) },
] }).bytes;
const legacyBook = buildCfb({ version: 3, entries: [{ name: "Book", data: new Uint8Array(100) }] }).bytes;
const infoOnly = buildCfb({ version: 3, entries: [{ name: "EncryptionInfo", data: le(4, 4, 0x40) }] }).bytes;

// يعيد تغليف تيارات الملف المشفّر الحقيقي في ملف OLE جديد (مع تعديلات اختيارية) — لاختبار حالات التلف
const realStreams = readOle(encrypted).streams;
const realInfoXml = new TextDecoder().decode(realStreams.get("EncryptionInfo").subarray(8));
function repack(opts) {
  opts = opts || {};
  const xml = opts.xml ? opts.xml(realInfoXml) : realInfoXml;
  const info = withHeader(realStreams.get("EncryptionInfo").subarray(0, 8), new TextEncoder().encode(xml));
  const pkg = opts.pkg ? opts.pkg(realStreams.get("EncryptedPackage")) : realStreams.get("EncryptedPackage");
  return buildCfb({ version: opts.version || 3, entries: [
    { name: opts.lowerCase ? "encryptioninfo" : "EncryptionInfo", data: info },
    { name: "EncryptedPackage", data: pkg },
  ] }).bytes;
}
// يغيّر قيمة خاصية داخل عنصر p:encryptedKey فقط
const setKeyAttr = (name, value) => (xml) =>
  xml.replace(/<p:encryptedKey\b[^>]*>/, (tag) => tag.replace(new RegExp(" " + name + '="[^"]*"'), ` ${name}="${value}"`));

/* ---------- inspectOle ---------- */
eq("inspectOle: msoffcrypto agile file", X.inspectOle(encrypted).kind, "encrypted-agile");
eq("inspectOle: agile reports version 4.4", X.inspectOle(encrypted).version, "4.4");
eq("inspectOle: standard 3.2 (Excel 2007)", X.inspectOle(standard32).kind, "encrypted-standard");
eq("inspectOle: standard 4.2", X.inspectOle(standard42).kind, "encrypted-standard");
eq("inspectOle: extensible 4.3 → other", X.inspectOle(extensible).kind, "encrypted-other");
eq("inspectOle: legacy .xls (Workbook stream)", X.inspectOle(legacyXls).kind, "legacy-xls");
eq("inspectOle: legacy .xls (Book stream, Excel 5)", X.inspectOle(legacyBook).kind, "legacy-xls");
eq("inspectOle: EncryptionInfo without EncryptedPackage → legacy-xls", X.inspectOle(infoOnly).kind, "legacy-xls");
eq("inspectOle: plain .xlsx (ZIP) → not-ole", X.inspectOle(plain).kind, "not-ole");
eq("inspectOle: empty bytes → not-ole", X.inspectOle(new Uint8Array(0)).kind, "not-ole");
eq("inspectOle: stream names matched case-insensitively", X.inspectOle(repack({ lowerCase: true })).kind, "encrypted-agile");
eq("inspectOle: accepts ArrayBuffer", X.inspectOle(encrypted.buffer.slice(encrypted.byteOffset, encrypted.byteOffset + encrypted.length)).kind, "encrypted-agile");
expectCode("inspectOle: corrupt OLE", () => X.inspectOle(encrypted.subarray(0, 1500)), "BADOLE");

/* ---------- decryptAgile: كلمة السر الصحيحة ---------- */
let decrypted = null;
{
  const t0 = Date.now();
  decrypted = X.decryptAgile(encrypted, PASSWORD);
  const ms = Date.now() - t0;
  console.log(`INFO: decryptAgile (spinCount=100000, ${encrypted.length} bytes): ${ms} ms`);
  check("decryptAgile finishes in < 5 s", ms < 5000, ms);
  check("decrypted package is byte-identical to plain.xlsx", sameBytes(decrypted, plain), decrypted && decrypted.length);
  check("decrypted package is byte-identical to msoffcrypto's decryption", sameBytes(decrypted, msoffDecrypted));
}
check("Arabic password (UTF-16LE) + spinCount read from file (1000)", sameBytes(X.decryptAgile(encryptedAr, PASSWORD_AR), plain));
check("fixture repacked into a v4 (4096-byte sector) OLE still decrypts", sameBytes(X.decryptAgile(repack({ version: 4 }), PASSWORD), plain));

/* ---------- كلمات سر خاطئة وحالات التلف ---------- */
expectCode("decryptAgile: wrong password", () => X.decryptAgile(encrypted, "tamim-123"), "BADPASSWORD");
{
  const e = thrown(() => X.decryptAgile(encryptedAr, "Tamim-123"));
  eq("BADPASSWORD message", e && e.arMessage, "كلمة السر غير صحيحة.");
}
expectCode("decryptAgile: SHA1 hash (not supported)", () => X.decryptAgile(repack({ xml: (x) => x.replace(/hashAlgorithm="SHA512"/g, 'hashAlgorithm="SHA1"') }), PASSWORD), "UNSUPPORTED_ENCRYPTION");
expectCode("decryptAgile: non-CBC chaining", () => X.decryptAgile(repack({ xml: (x) => x.replace(/ChainingModeCBC/g, "ChainingModeCFB") }), PASSWORD), "UNSUPPORTED_ENCRYPTION");
expectCode("decryptAgile: certificate-only key encryptor", () => X.decryptAgile(repack({ xml: (x) => x.replace(/uri="([^"]*)keyEncryptor\/password"/, 'uri="$1keyEncryptor/certificate"') }), PASSWORD), "UNSUPPORTED_ENCRYPTION");
expectCode("decryptAgile: missing encryptedKeyValue", () => X.decryptAgile(repack({ xml: (x) => x.replace(/encryptedKeyValue="[^"]*"/, "") }), PASSWORD), "BADENCRYPTION");
expectCode("decryptAgile: invalid base64 in saltValue", () => X.decryptAgile(repack({ xml: setKeyAttr("saltValue", "@@@") }), PASSWORD), "BADENCRYPTION");
// الحد الأقصى في المواصفة 10,000,000 — قيمة أكبر تعني ملفًا تالفًا (وتمنع تجميد الصفحة)
expectCode("decryptAgile: spinCount above the spec maximum", () => X.decryptAgile(repack({ xml: setKeyAttr("spinCount", "10000001") }), PASSWORD), "BADENCRYPTION");
expectCode("decryptAgile: package shorter than its declared size", () => X.decryptAgile(repack({ pkg: (p) => p.subarray(0, 8 + 4096) }), PASSWORD), "BADENCRYPTION");
expectCode("decryptAgile: package without size header", () => X.decryptAgile(repack({ pkg: (p) => p.subarray(0, 4) }), PASSWORD), "BADENCRYPTION");
expectCode("decryptAgile: standard-encrypted file", () => X.decryptAgile(standard32, PASSWORD), "STANDARD_ENCRYPTION");
expectCode("decryptAgile: legacy .xls", () => X.decryptAgile(legacyXls, PASSWORD), "LEGACY_XLS");
check("decryptAgile: XML attributes in single quotes", sameBytes(X.decryptAgile(repack({ xml: (x) => x.replace(/="([^"]*)"/g, "='$1'") }), PASSWORD), plain));
check("decryptAgile: trailing bytes after the padded package are ignored", sameBytes(X.decryptAgile(repack({ pkg: (p) => withHeader(p, new Uint8Array(7)) }), PASSWORD), plain));

/* ---------- decryptXlsx: نقطة الدخول للواجهة ---------- */
check("decryptXlsx: correct password", sameBytes(X.decryptXlsx(encrypted, PASSWORD), plain));
expectCode("decryptXlsx: empty password", () => X.decryptXlsx(encrypted, ""), "NOPASSWORD");
expectCode("decryptXlsx: undefined password", () => X.decryptXlsx(encrypted), "NOPASSWORD");
expectCode("decryptXlsx: wrong password", () => X.decryptXlsx(encrypted, "wrong"), "BADPASSWORD");
{
  const e = expectCode("decryptXlsx: standard encryption", () => X.decryptXlsx(standard32, PASSWORD), "STANDARD_ENCRYPTION");
  eq("STANDARD_ENCRYPTION message", e && e.arMessage, "هذا الملف مشفّر بطريقة Excel 2007 القديمة — افتحه في Excel حديث واحفظه من جديد ثم أعد المحاولة.");
}
{
  // لا داعي لطلب كلمة سر لملف لن نستطيع فتحه أصلًا
  const e = expectCode("decryptXlsx: legacy .xls even with empty password", () => X.decryptXlsx(legacyXls, ""), "LEGACY_XLS");
  eq("LEGACY_XLS message", e && e.arMessage, "ملفات .xls القديمة غير مدعومة — افتح الملف في Excel واحفظه بصيغة .xlsx.");
}
expectCode("decryptXlsx: extensible encryption", () => X.decryptXlsx(extensible, PASSWORD), "UNSUPPORTED_ENCRYPTION");
expectCode("decryptXlsx: not an OLE file", () => X.decryptXlsx(plain, PASSWORD), "NOT_ENCRYPTED");
check("decryptXlsx returns synchronously (not a Promise)", !(X.decryptXlsx(encryptedAr, PASSWORD_AR) instanceof Promise));

/* ---------- في سياق يشبه المتصفح: تسجيل Tamim.core.xlsxCrypt واعتماداته عبر Tamim.core ---------- */
{
  const ctx = vm.createContext({ TextEncoder, TextDecoder, console });
  ctx.globalThis = ctx;
  ["zip", "crypto", "ole", "xlsx-crypt"].forEach((m) => {
    const file = path.join(__dirname, "..", "js", "core", m + ".js");
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  });
  const core = ctx.Tamim && ctx.Tamim.core;
  check("browser: Tamim.core.ole registered", !!core && typeof core.ole.readOle === "function");
  check("browser: Tamim.core.crypto registered", !!core && typeof core.crypto.sha512 === "function");
  check("browser: Tamim.core.xlsxCrypt registered", !!core && typeof core.xlsxCrypt.decryptXlsx === "function");
  const out = thrown(() => core.xlsxCrypt.decryptXlsx(encryptedAr, PASSWORD_AR)) || core.xlsxCrypt.decryptXlsx(encryptedAr, PASSWORD_AR);
  check("browser: decryptXlsx works with injected dependencies", sameBytes(out, plain), out && out.message);
  const e = thrown(() => core.xlsxCrypt.decryptXlsx(encryptedAr, "x"));
  eq("browser: errors come from zip.xlsxError", e && e.code, "BADPASSWORD");
}

/* ---------- المحتوى بعد فك التشفير يقرؤه parseXlsx كالملف الأصلي ---------- */
(async () => {
  const fromDecrypted = await parseXlsx(decrypted);
  const fromPlain = await parseXlsx(plain);
  same("parseXlsx(decrypted) equals parseXlsx(plain.xlsx)", fromDecrypted, fromPlain);
  eq("sheet name", fromDecrypted[0] && fromDecrypted[0].sheetName, "Cards");
  same("rows (strings kept, leading zero kept, numeric cell as text)", fromDecrypted[0] && fromDecrypted[0].rows, [
    ["PIN", "SN", "Value"],
    ["0012345678901234", "900000000001", "10"],
    ["1234567890123456", "900000000002", "20"],
    ["9876543210987654", "900000000003", "50"],
  ]);
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
