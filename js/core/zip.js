"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./csv.js" ← T.core.csv — نفس سطر require يعمل في المتصفح وفي Node
    T.core.zip = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {

/* ---------- كاتب ZIP (طريقة STORE بلا ضغط، بلا أي تبعيات) ---------- */

// جدول CRC-32 (متعدد الحدود 0xEDB88320) يُبنى مرة واحدة ويُخزَّن.
let CRC_TABLE = null;
function crc32Table() {
  if (CRC_TABLE) return CRC_TABLE;
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  CRC_TABLE = t;
  return t;
}

// CRC-32 لمصفوفة بايتات (Uint8Array) — دالة نقيّة. crc32("123456789") === 0xCBF43926.
function crc32(bytes) {
  const t = crc32Table();
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = t[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// يبني أرشيف ZIP (Uint8Array) من entries = [{ name, data: Uint8Array }].
// STORE فقط، مع رفع علم UTF-8 (bit 11 = 0x0800) لأن أسماء المجلدات/الملفات عربية.
function buildZip(entries) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 0xff, (n >>> 8) & 0xff];
  const u32 = (n) => { n = n >>> 0; return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]; };
  const FLAG_UTF8 = 0x0800;
  const DOS_DATE = 0x0021; // 1980-01-01، تاريخ ثابت صالح
  const DOS_TIME = 0x0000;

  const localParts = [];   // رؤوس الملفات المحلية + البيانات
  const centralParts = []; // سجلات الفهرس المركزي
  let offset = 0;

  entries.forEach((e) => {
    const nameBytes = enc.encode(e.name);
    const data = e.data;
    const crc = crc32(data);
    const size = data.length;

    const lh = [];
    lh.push(...u32(0x04034b50));      // توقيع الرأس المحلي PK\x03\x04
    lh.push(...u16(20));              // النسخة المطلوبة
    lh.push(...u16(FLAG_UTF8));       // الأعلام العامة (UTF-8)
    lh.push(...u16(0));               // طريقة الضغط = STORE
    lh.push(...u16(DOS_TIME));
    lh.push(...u16(DOS_DATE));
    lh.push(...u32(crc));
    lh.push(...u32(size));            // الحجم المضغوط
    lh.push(...u32(size));            // الحجم الأصلي
    lh.push(...u16(nameBytes.length));
    lh.push(...u16(0));               // طول الحقل الإضافي
    const localHeader = Uint8Array.from(lh);
    localParts.push(localHeader, nameBytes, data);
    const localOffset = offset;
    offset += localHeader.length + nameBytes.length + size;

    const ch = [];
    ch.push(...u32(0x02014b50));      // توقيع الفهرس المركزي PK\x01\x02
    ch.push(...u16(20));              // نسخة المُنشئ
    ch.push(...u16(20));              // النسخة المطلوبة
    ch.push(...u16(FLAG_UTF8));
    ch.push(...u16(0));               // STORE
    ch.push(...u16(DOS_TIME));
    ch.push(...u16(DOS_DATE));
    ch.push(...u32(crc));
    ch.push(...u32(size));
    ch.push(...u32(size));
    ch.push(...u16(nameBytes.length));
    ch.push(...u16(0));               // إضافي
    ch.push(...u16(0));               // تعليق
    ch.push(...u16(0));               // رقم القرص
    ch.push(...u16(0));               // سمات داخلية
    ch.push(...u32(0));               // سمات خارجية
    ch.push(...u32(localOffset));     // إزاحة الرأس المحلي
    centralParts.push(Uint8Array.from(ch), nameBytes);
  });

  let centralSize = 0;
  centralParts.forEach((p) => { centralSize += p.length; });
  const centralOffset = offset;

  const eocd = [];
  eocd.push(...u32(0x06054b50));      // توقيع نهاية الفهرس المركزي PK\x05\x06
  eocd.push(...u16(0));               // رقم القرص
  eocd.push(...u16(0));               // قرص بداية الفهرس
  eocd.push(...u16(entries.length));  // عدد السجلات في هذا القرص
  eocd.push(...u16(entries.length));  // إجمالي السجلات
  eocd.push(...u32(centralSize));
  eocd.push(...u32(centralOffset));
  eocd.push(...u16(0));               // طول التعليق
  const eocdArr = Uint8Array.from(eocd);

  const total = offset + centralSize + eocdArr.length;
  const out = new Uint8Array(total);
  let pos = 0;
  localParts.forEach((p) => { out.set(p, pos); pos += p.length; });
  centralParts.forEach((p) => { out.set(p, pos); pos += p.length; });
  out.set(eocdArr, pos);
  return out;
}

// خطأ يحمل رسالة عربية واضحة تُعرض في الواجهة عند تعذّر القراءة
function xlsxError(code, arMessage) {
  const e = new Error(arMessage);
  e.code = code;
  e.arMessage = arMessage;
  return e;
}

// فكّ ضغط DEFLATE الخام عبر واجهة الويب المدمجة (المتصفح وNode ≥18)
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") {
    throw xlsxError("NODEFLATE", "متصفحك لا يدعم فكّ ضغط ملفات Excel — الرجاء استخدام متصفح حديث (Chrome أو Edge أو Firefox أو Safari) أو حفظ الملف بصيغة CSV.");
  }
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  writer.write(bytes).catch(() => {});
  writer.close().catch(() => {});
  const reader = ds.readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.length;
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) { out.set(c, pos); pos += c.length; }
  return out;
}

// قراءة أرشيف ZIP: EOCD → الفهرس المركزي → الرؤوس المحلية. يدعم STORE وDEFLATE.
// يعيد Promise لمصفوفة { name, data: Uint8Array }. يرمي خطأً واضحًا إن كان الأرشيف تالفًا.
async function parseZipEntries(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const u16 = (o) => dv.getUint16(o, true);
  const u32 = (o) => dv.getUint32(o, true);

  // ابحث عن توقيع نهاية الفهرس المركزي PK\x05\x06 من النهاية (مع مراعاة التعليق)
  let eocd = -1;
  for (let i = b.length - 22; i >= 0; i--) {
    if (b[i] === 0x50 && b[i + 1] === 0x4b && b[i + 2] === 0x05 && b[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw xlsxError("BADZIP", "ملف غير صالح: تعذّر العثور على فهرس ZIP.");
  const count = u16(eocd + 10);
  const cdOffset = u32(eocd + 16);

  const entries = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > b.length || u32(p) !== 0x02014b50) throw xlsxError("BADZIP", "أرشيف ZIP تالف: سجل فهرس غير صالح.");
    const method = u16(p + 10);
    const compSize = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const localOff = u32(p + 42);
    const name = new TextDecoder("utf-8").decode(b.subarray(p + 46, p + 46 + nameLen));
    if (localOff + 30 > b.length || u32(localOff) !== 0x04034b50) throw xlsxError("BADZIP", "أرشيف ZIP تالف: رأس محلي غير صالح.");
    // الرأس المحلي قد تختلف أطوال حقوله عن الفهرس المركزي — اقرأها منه
    const lNameLen = u16(localOff + 26);
    const lExtraLen = u16(localOff + 28);
    const dataStart = localOff + 30 + lNameLen + lExtraLen;
    const comp = b.subarray(dataStart, dataStart + compSize);
    let data;
    if (method === 0) data = comp.slice();                // STORE — نسخ البايتات
    else if (method === 8) data = await inflateRaw(comp);  // DEFLATE
    else throw xlsxError("BADZIP", `طريقة ضغط غير مدعومة داخل الملف (${method}).`);
    entries.push({ name, data });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

return { xlsxError, crc32, buildZip, inflateRaw, parseZipEntries };
});
