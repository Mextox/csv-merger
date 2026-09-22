"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./zip.js" ← T.core.zip — نفس سطر require يعمل في المتصفح وفي Node
    T.core.ole = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { xlsxError } = require("./zip.js");

/* =====================================================================
 * قارئ الملفات المركّبة OLE2 / CFB (MS-CFB) — بلا تبعيات.
 * ملفات Excel المشفّرة بكلمة سر (وملفات .xls القديمة) مخزّنة بهذه الصيغة:
 * نظام ملفات مصغّر داخل الملف: قطاعات + جدول FAT يربطها في سلاسل + دليل بأسماء التيارات.
 * يدعم الإصدار 3 (قطاعات 512 بايت) والإصدار 4 (قطاعات 4096 بايت)، وسلسلة DIFAT الإضافية،
 * والتيار المصغّر (التيارات الأصغر من 4096 بايت مخزّنة في قطاعات من 64 بايت).
 * أي بنية تالفة (حلقة، قطاع خارج الملف، تيار أطول من سلسلته) ← خطأ BADOLE بدل التعليق أو قراءة بيانات خاطئة.
 * ===================================================================== */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const MAXREGSECT = 0xfffffffa; // أكبر رقم قطاع عادي؛ ما فوقه قيم خاصة
const ENDOFCHAIN = 0xfffffffe;
const NOSTREAM = 0xffffffff;
const HEADER_DIFAT_COUNT = 109;
const DIR_ENTRY_SIZE = 128;
const TYPE_STORAGE = 1, TYPE_STREAM = 2, TYPE_ROOT = 5;

function toBytes(bytes) {
  return bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
}

function isOle(bytes) {
  const b = toBytes(bytes);
  if (b.length < SIGNATURE.length) return false;
  for (let i = 0; i < SIGNATURE.length; i++) if (b[i] !== SIGNATURE[i]) return false;
  return true;
}

// detail للمطوّر فقط (يظهر في وحدة التحكم)؛ الرسالة العربية هي ما يُعرض للمستخدم
function badOle(detail) {
  const e = xlsxError("BADOLE", "تعذّرت قراءة الملف: بنيته الداخلية تالفة أو غير مكتملة. جرّب فتحه في Excel وحفظه من جديد ثم أعد المحاولة.");
  e.detail = detail;
  return e;
}

// يقرأ الملف المركّب ويعيد { streams: Map<اسم, Uint8Array> }.
// تيارات الجذر تُخزَّن باسمها كما هو، والتيارات داخل مجلدات (storages) بمسارها: "مجلد/تيار".
function readOle(bytes) {
  let b = toBytes(bytes);
  if (!isOle(b)) throw badOle("signature");
  if (b.length < 512) throw badOle("header too short");
  let dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint16(28, true) !== 0xfffe) throw badOle("byte order");
  const shift = dv.getUint16(30, true);
  if (shift !== 9 && shift !== 12) throw badOle("sector shift " + shift);
  if (dv.getUint16(32, true) !== 6) throw badOle("mini sector shift");
  const ss = 1 << shift;             // حجم القطاع (الرأس يشغل أول قطاع كامل)
  const perSector = ss / 4;          // عدد مدخلات FAT في القطاع
  const numFat = dv.getUint32(44, true);
  const firstDir = dv.getUint32(48, true);
  const miniCutoff = dv.getUint32(56, true);
  const firstMiniFat = dv.getUint32(60, true);
  const firstDifat = dv.getUint32(68, true);
  const numDifat = dv.getUint32(72, true);

  if (b.length <= ss) throw badOle("no sectors");
  const sectorCount = Math.ceil(b.length / ss) - 1; // يشمل آخر قطاع ولو كان ناقصًا
  // آخر قطاع ناقص (يحدث مع بعض البرامج): نكمله بأصفار حتى لا نقرأ خارج الملف
  if (b.length % ss !== 0) {
    const padded = new Uint8Array((sectorCount + 1) * ss);
    padded.set(b);
    b = padded;
    dv = new DataView(b.buffer);
  }
  if (numFat === 0 || numFat > sectorCount) throw badOle("FAT sector count");

  const sectorOffset = (s) => {
    if (s > MAXREGSECT || s >= sectorCount) throw badOle("sector out of range: " + s);
    return (s + 1) * ss;
  };

  // 1) مواقع قطاعات FAT: أول 109 في الرأس، والباقي في سلسلة قطاعات DIFAT
  const fatSectors = [];
  for (let i = 0; i < HEADER_DIFAT_COUNT && fatSectors.length < numFat; i++) fatSectors.push(dv.getUint32(76 + i * 4, true));
  const seenDifat = new Set();
  let d = firstDifat;
  while (fatSectors.length < numFat) {
    if (seenDifat.has(d) || seenDifat.size >= numDifat + 1) throw badOle("DIFAT chain");
    seenDifat.add(d);
    const off = sectorOffset(d);
    for (let i = 0; i < perSector - 1 && fatSectors.length < numFat; i++) fatSectors.push(dv.getUint32(off + i * 4, true));
    d = dv.getUint32(off + ss - 4, true);
  }

  // 2) جدول FAT الكامل
  const fat = new Uint32Array(numFat * perSector);
  fatSectors.forEach((s, k) => {
    const off = sectorOffset(s);
    for (let i = 0; i < perSector; i++) fat[k * perSector + i] = dv.getUint32(off + i * 4, true);
  });

  // يتبع سلسلة في table بدءًا من start ويعيد أول `count` رقمًا منها (أو السلسلة كلها إن كان count = Infinity).
  // limit = عدد الوحدات الموجودة فعلًا؛ أي رقم خارجه أو مكرر (حلقة) ← BADOLE.
  function followChain(table, start, count, limit, what) {
    const out = [];
    const seen = new Uint8Array(limit);
    let s = start;
    while (out.length < count && s !== ENDOFCHAIN) {
      if (s > MAXREGSECT || s >= table.length || s >= limit) throw badOle(what + ": sector out of range " + s);
      if (seen[s]) throw badOle(what + ": chain loop at " + s);
      seen[s] = 1;
      out.push(s);
      s = table[s];
    }
    if (count !== Infinity && out.length < count) throw badOle(what + ": chain shorter than stream");
    return out;
  }

  // قراءة تيار من القطاعات العادية
  function readRegular(start, size, what) {
    const out = new Uint8Array(size);
    const chain = followChain(fat, start, Math.ceil(size / ss), sectorCount, what);
    chain.forEach((s, i) => {
      const off = sectorOffset(s);
      const n = Math.min(ss, size - i * ss);
      out.set(b.subarray(off, off + n), i * ss);
    });
    return out;
  }

  // 3) الدليل: كل مدخل 128 بايت
  const dirChain = followChain(fat, firstDir, Infinity, sectorCount, "directory");
  if (dirChain.length === 0) throw badOle("empty directory");
  const entries = [];
  dirChain.forEach((s) => {
    const base = sectorOffset(s);
    for (let o = base; o < base + ss; o += DIR_ENTRY_SIZE) {
      const nameLen = dv.getUint16(o + 64, true);
      const chars = Math.max(0, Math.min(32, nameLen >> 1) - 1); // بلا محرف النهاية
      let name = "";
      for (let c = 0; c < chars; c++) name += String.fromCharCode(dv.getUint16(o + c * 2, true));
      const sizeLo = dv.getUint32(o + 120, true);
      const sizeHi = dv.getUint32(o + 124, true);
      entries.push({
        name,
        type: b[o + 66],
        left: dv.getUint32(o + 68, true),
        right: dv.getUint32(o + 72, true),
        child: dv.getUint32(o + 76, true),
        start: dv.getUint32(o + 116, true),
        // الإصدار 3: الـ 32 بت العليا من الحجم قد تحمل قيمًا عشوائية ويجب تجاهلها
        size: ss === 512 ? sizeLo : sizeLo + sizeHi * 4294967296,
      });
    }
  });
  const root = entries[0];
  if (root.type !== TYPE_ROOT) throw badOle("root entry type");

  // 4) التيار المصغّر (بيانات مدخل الجذر) وجدوله miniFAT — يُحمَّلان فقط عند الحاجة
  let miniStream = null, miniFat = null;
  function readMini(start, size, what) {
    if (!miniStream) {
      if (root.size > sectorCount * ss) throw badOle("mini stream size");
      miniStream = readRegular(root.start, root.size, "mini stream");
      const mfChain = followChain(fat, firstMiniFat, Infinity, sectorCount, "mini FAT");
      miniFat = new Uint32Array(mfChain.length * perSector);
      mfChain.forEach((s, k) => {
        const off = sectorOffset(s);
        for (let i = 0; i < perSector; i++) miniFat[k * perSector + i] = dv.getUint32(off + i * 4, true);
      });
    }
    const miniCount = miniStream.length >> 6; // قطاعات 64 بايت
    const out = new Uint8Array(size);
    const chain = followChain(miniFat, start, Math.ceil(size / 64), miniCount, what);
    chain.forEach((s, i) => {
      const n = Math.min(64, size - i * 64);
      out.set(miniStream.subarray(s * 64, s * 64 + n), i * 64);
    });
    return out;
  }

  function readStream(e, path) {
    if (e.size === 0) return new Uint8Array(0);
    if (e.size > b.length) throw badOle(path + ": size larger than file");
    return e.size < miniCutoff ? readMini(e.start, e.size, path) : readRegular(e.start, e.size, path);
  }

  // 5) المرور على شجرة الدليل (الإخوة في شجرة ثنائية يسار/يمين، ومحتوى كل مجلد تحت child)
  const streams = new Map();
  const visited = new Set([0]);
  const stack = [{ idx: root.child, prefix: "" }];
  while (stack.length) {
    const { idx, prefix } = stack.pop();
    if (idx === NOSTREAM) continue;
    if (idx >= entries.length) throw badOle("directory index out of range " + idx);
    if (visited.has(idx)) throw badOle("directory cycle at " + idx);
    visited.add(idx);
    const e = entries[idx];
    stack.push({ idx: e.left, prefix }, { idx: e.right, prefix });
    if (e.type === TYPE_STREAM) streams.set(prefix + e.name, readStream(e, prefix + e.name));
    else if (e.type === TYPE_STORAGE) stack.push({ idx: e.child, prefix: prefix + e.name + "/" });
  }
  return { streams };
}

// البحث عن تيار في الجذر بلا حساسية لحالة الأحرف (كما في مواصفة CFB). يعيد null إن لم يوجد.
function getStream(ole, name) {
  if (ole.streams.has(name)) return ole.streams.get(name);
  const want = String(name).toUpperCase();
  for (const [k, v] of ole.streams) if (k.toUpperCase() === want) return v;
  return null;
}

return { isOle, readOle, getStream };
});
