"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.split = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { parseCSV } = require("./csv.js");

/* =====================================================================
 * أخذ الكروت من ملف جاهز: مدى أسطر، سحب كمية من النهاية، إضافة أكواد التمبلت،
 * التقسيم إلى أجزاء، والتصدير بقالب Batch. كل دالة نقيّة.
 * الأسطر تبقى كما هي نصًّا (لا تحويل أرقام)، والمتبقي يُعاد دائمًا لتنزيله.
 * ===================================================================== */

// أسطر الملف بلا السطر الفارغ الأخير (يُحتفظ بالأسطر الفارغة الوسطى كما في السكربتات القديمة)
function toLines(text) {
  const lines = String(text == null ? "" : text).split(/\r?\n/);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

// صفوف CSV غير الفارغة (لأدوات الكروت ذات الأعمدة الأربعة)
function toRows(text) {
  return parseCSV(String(text == null ? "" : text), ",").rows.filter((r) => r.some((c) => c !== ""));
}

/* ---------- تحديد المدى ---------- */

// يحدد المدى المأخوذ: إمّا آخر lastLines سطرًا، أو من startLine وعدد count (0 = حتى النهاية).
// يعيد فهارس صفرية [from, to) مقصوصة داخل حدود الملف.
function rangeOf(total, opts) {
  const last = Math.max(0, Math.floor(opts.lastLines || 0));
  if (last > 0) return { from: Math.max(0, total - last), to: total };
  const start = Math.min(Math.max(1, Math.floor(opts.startLine || 1)), Math.max(total, 1));
  const count = Math.max(0, Math.floor(opts.count || 0));
  const to = count === 0 ? total : Math.min(start - 1 + count, total);
  return { from: start - 1, to: Math.max(start - 1, to) };
}

/* ---------- تحويل الأسطر ---------- */

// يطبّق على كل سطر: عكس أول عمودين (lby)، الاقتصار على عمودين (بلا حماية الأعمدة)،
// وإضافة كود التمبلت وكود الفئة في النهاية. سطر بأقل من عمودين يبقى كما هو.
function transformLine(line, opts) {
  const raw = String(line).trim();
  let parts = raw.split(",");
  if (parts.length < 2) return raw;
  if (!opts.protectColumns) parts = parts.slice(0, 2);
  if (opts.swapFirstTwo) parts = [parts[1], parts[0]].concat(parts.slice(2));
  if (opts.codes && opts.codes.length) parts = parts.concat(opts.codes);
  return parts.join(",");
}

// يأخذ المدى ويحوّله، ويعيد الأسطر المأخوذة والباقي (لتنزيله بدل تعديل الملف الأصلي).
function takeLines(text, opts) {
  const lines = toLines(text);
  const { from, to } = rangeOf(lines.length, opts);
  const taken = lines.slice(from, to).map((l) => transformLine(l, opts));
  const remaining = lines.filter((_, i) => i < from || i >= to);
  return { taken, remaining, from: from + 1, to, total: lines.length };
}

/* ---------- التقسيم إلى أجزاء وأسماء الملفات ---------- */

function chunk(items, size) {
  const n = Math.max(0, Math.floor(size || 0)) || items.length || 1;
  const out = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

// اسم الملف كما في البرنامج القديم: {الاسم}_{الرقم}.csv مع إمكانية بدء الترقيم من رقم معيّن
const partName = (base, index, startNumber) => `${base}_${(startNumber || 1) + index}.csv`;

// dd-mm-yyyy (اسم مجلد اليوم في البرنامج القديم)
function folderDate(d) {
  const x = d || new Date();
  const p = (n) => (n < 10 ? "0" : "") + n;
  return `${p(x.getDate())}-${p(x.getMonth() + 1)}-${x.getFullYear()}`;
}

// ملفات جاهزة للتنزيل: [{ name, path, lines, text }]
function buildParts(taken, opts) {
  const base = (opts.customName || opts.sourceName || "cards").replace(/\.[^.]+$/, "");
  const folder = opts.folder === false ? "" : folderDate(opts.date);
  return chunk(taken, opts.splitSize).map((part, i) => {
    const name = partName(base, i, opts.startNumber);
    return { name, path: folder ? `${folder}/${name}` : name, lines: part.length, text: part.join("\n") };
  });
}

/* ---------- سحب كمية من نهاية ملف كروت (DOJON) ---------- */

// يأخذ آخر qty صفًّا ويعيد الباقي. كود الفئة يؤخذ من العمود الرابع لأول صف.
function pullQuantity(text, qty) {
  const rows = toRows(text);
  const n = Math.min(Math.max(0, Math.floor(qty || 0)), rows.length);
  return {
    taken: rows.slice(rows.length - n),
    remaining: rows.slice(0, rows.length - n),
    total: rows.length,
    categoryCode: rows.length && rows[0].length > 3 ? rows[0][3] : "",
  };
}

// نص التصدير بقالب Batch: رأس القالب، ثم "السيريال الرقم السري" لكل كرت، ثم ذيل القالب.
function batchExport(rows, template) {
  const body = rows.map((r) => `${r[1] == null ? "" : r[1]} ${r[0] == null ? "" : r[0]}`).join("\n");
  return `${template.start}\n${body}\n${template.end}`;
}

// اختيار القالب المناسب لكود الفئة (القوالب: [{ code, start, end }])
const templateFor = (templates, code) => (templates || []).find((t) => String(t.code) === String(code)) || null;

/* ---------- إضافة نص لنهاية الأسطر ---------- */

function appendToLines(text, suffix) {
  return toLines(text).map((l) => {
    const t = l.trim();
    return t === "" ? "" : t + "," + String(suffix).trim();
  }).join("\n");
}

/* ---------- تحويل صفوف إلى نص CSV بفواصل ---------- */

const rowsToText = (rows) => rows.map((r) => r.join(",")).join("\n");

return { toLines, toRows, rangeOf, transformLine, takeLines, chunk, partName, folderDate, buildParts, pullQuantity, batchExport, templateFor, appendToLines, rowsToText };
});
