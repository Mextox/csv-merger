"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.serials = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { normalizeCell } = require("./text.js");

/* =====================================================================
 * أدوات السيريال: توليد الأكواد والسيريالات، استخراج عمود، الفلترة بالطول،
 * المطابقة (مطابق/غير مطابق)، والبحث عن سيريالات داخل ملفات.
 * كلها دوال نقيّة؛ العشوائية تُمرَّر من الخارج ليمكن اختبارها.
 * ===================================================================== */

const DIGITS = "0123456789";
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const CHARSETS = { digits: DIGITS, letters: LETTERS, both: LETTERS + DIGITS };

// عشوائية مشفّرة افتراضيًا (نفس مستوى secrets في بايثون)
function defaultRandom(n) {
  const out = new Uint8Array(n);
  if (globalThis.crypto && crypto.getRandomValues) crypto.getRandomValues(out);
  else for (let i = 0; i < n; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

// اختيار محرف واحد بلا انحياز (رفض القيم الزائدة كما يفعل secrets.choice)
function pickChar(chars, random) {
  const limit = Math.floor(256 / chars.length) * chars.length;
  for (;;) {
    const b = random(1)[0];
    if (b < limit) return chars[b % chars.length];
  }
}

// yyyymmdd (تاريخ السيريال كما في البرنامج القديم)
function ymd(date) {
  const d = date || new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

// السيريال = رقم الدفعة + التاريخ + الترتيب بستة أرقام
const batchSerial = (batch, date, index) => `${batch}${ymd(date)}${String(index).padStart(6, "0")}`;

// توليد أكواد سرية غير مكررة (لا داخل الدفعة ولا مع ما وُلّد سابقًا).
// known: مجموعة الأكواد السابقة (أو بصماتها عبر hashOf). يعيد أيضًا سبب التوقف إن تعذّر الاكتمال.
function generateCodes(opts) {
  const chars = CHARSETS[opts.type] || CHARSETS.both;
  const random = opts.random || defaultRandom;
  const hashOf = opts.hashOf || ((c) => c);
  const known = opts.known instanceof Set ? opts.known : new Set(opts.known || []);
  const length = Math.max(1, Math.floor(opts.length || 0));
  const count = Math.max(0, Math.floor(opts.count || 0));
  const maxAttempts = opts.maxAttempts || count * 10;
  const rows = [];
  const seen = new Set();
  let attempts = 0;
  while (rows.length < count && attempts < maxAttempts) {
    attempts++;
    let code = "";
    for (let i = 0; i < length; i++) code += pickChar(chars, random);
    const key = hashOf(code);
    if (seen.has(key) || known.has(key)) continue;
    seen.add(key);
    rows.push({ code, serial: batchSerial(opts.batch, opts.date, rows.length + 1) });
  }
  return {
    rows,
    complete: rows.length === count,
    attempts,
    newKeys: [...seen],
    message: rows.length === count ? "" : `تعذّر توليد ${count} كودًا غير مكرر بطول ${length} — زد الطول أو قلّل العدد.`,
  };
}

/* ---------- إضافة سيريال وأكواد إلى ملف أكواد جاهز ---------- */

// تاريخ السيريال في SIRIAL_v3: يوم+شهر+سنة بلا أصفار بادئة (كما في البرنامج القديم)
const shortDate = (d) => `${d.getDate()}${d.getMonth() + 1}${d.getFullYear()}`;

// يضع السيريال في العمود الثاني، ثم كود الشركة، ثم كود الفئة — ويبقي بقية الأعمدة بعدها
function insertSerials(rows, opts) {
  const date = opts.date || new Date();
  return rows.map((row, i) => {
    const serial = `${shortDate(date)}_${opts.source}_${opts.category}_${i + 1}`;
    const rest = row.slice(1);
    return [row[0], serial, opts.companyCode, opts.classCode].concat(rest);
  });
}

/* ---------- استخراج عمود / فلترة بالطول / المطابقة ---------- */

// عمود واحد من كل صف (index صفري) — الصفوف الأقصر تُتجاهل كما في البرنامج القديم
const pickColumn = (rows, index) => rows.filter((r) => r.length > index).map((r) => [r[index]]);

// الصفوف التي فيها خلية طولها يساوي المطلوب
const filterByLength = (rows, length) => rows.filter((r) => r.some((c) => String(c).trim().length === length));

// قيم البحث: كل خلية غير فارغة في ملف المرجع
function searchValues(rows) {
  const set = new Set();
  rows.forEach((r) => r.forEach((c) => { const v = String(c).trim(); if (v) set.add(v); }));
  return set;
}

// فصل الصفوف إلى مطابق وغير مطابق حسب وجود أي خلية ضمن قيم البحث
function matchSplit(rows, values) {
  const matched = [], unmatched = [];
  rows.forEach((r) => (r.some((c) => values.has(String(c).trim())) ? matched : unmatched).push(r));
  return { matched, unmatched };
}

/* ---------- البحث عن سيريالات داخل عدة ملفات ---------- */

// لكل سيريال: أطول سطر وُجد فيه (لتجنب الأسطر الناقصة)، مع اسم الملف.
// files: [{ name, lines: string[] }]
function searchSerials(files, serials) {
  const targets = [...new Set((serials || []).map((s) => String(s).trim()).filter(Boolean))];
  const found = new Map();
  (files || []).forEach((f) => {
    (f.lines || []).forEach((line) => {
      const text = String(line);
      if (!text.trim()) return;
      targets.forEach((t) => {
        if (!text.includes(t)) return;
        const prev = found.get(t);
        if (!prev || text.length > prev.line.length) found.set(t, { line: text, file: f.name });
      });
    });
  });
  return {
    rows: targets.filter((t) => found.has(t)).map((t) => ({ serial: t, line: found.get(t).line, file: found.get(t).file })),
    missing: targets.filter((t) => !found.has(t)),
    searched: targets.length,
  };
}

// قراءة قائمة سيريالات من نص (سطر لكل سيريال أو أول عمود في CSV)
function parseSerialList(text) {
  return String(text || "").split(/\r?\n/).map((l) => normalizeCell(l.split(",")[0])).filter(Boolean);
}

return { CHARSETS, ymd, batchSerial, generateCodes, shortDate, insertSerials, pickColumn, filterByLength, searchValues, matchSplit, searchSerials, parseSerialList };
});
