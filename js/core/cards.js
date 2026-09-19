"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    T.core.cards = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { digitsOnly, firstNumber, isScientific } = require("./text.js");

/* =====================================================================
 * الكرت الموحد { pin, serial, company, category }: أكواد الفئات، الفحوص، وبناء ملفات الإخراج.
 * ===================================================================== */

const FIELD_NAMES = { pin: "الرقم السري", serial: "السيريال" };
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

// يجمّع صفوفًا تحت (file, sheet) — كل فحص يُعرض مرة لكل ملف/ورقة مع أرقام صفوفه
function grouped(items, keyOf) {
  const map = new Map();
  items.forEach((it) => {
    const k = JSON.stringify([it.file, it.sheet, keyOf ? keyOf(it) : ""]);
    if (!map.has(k)) map.set(k, { file: it.file, sheet: it.sheet, items: [] });
    map.get(k).items.push(it);
  });
  return [...map.values()];
}
const where = (g) => `"${g.file}"${g.sheet ? ` — الورقة "${g.sheet}"` : ""}`;
const issue = (level, code, g, message, rows) => ({ level, code, message, file: g.file, sheet: g.sheet, rows });

/* ---------- أكواد الفئات والشركات ---------- */

function missingCategoryCodes(records, codes) {
  const seen = new Set();
  const out = [];
  records.forEach((r) => {
    const raw = r.categoryRaw;
    if (raw === "" || hasOwn(codes, raw) || seen.has(raw)) return;
    seen.add(raw);
    // رمز جاهز (مثل 10 أو h10) يُقترح كما هو؛ نص وصفي (مثل "كارت وي 100ج") تُقترح أرقامه
    out.push({ raw, suggestion: /^[A-Za-z0-9._-]+$/.test(raw) ? raw : digitsOnly(raw) || raw });
  });
  return out;
}

function assignCodes(records, codes) {
  const cards = records.map((r) => Object.assign({}, r, { category: hasOwn(codes, r.categoryRaw) && r.categoryRaw !== "" ? codes[r.categoryRaw] : "" }));
  const issues = [];
  grouped(cards.filter((c) => c.category === "")).forEach((g) => {
    const raws = [...new Set(g.items.map((c) => c.categoryRaw))].map((v) => (v === "" ? "(فارغة)" : `"${v}"`));
    issues.push(issue("error", "NO_CATEGORY_CODE", g, `${g.items.length} كرت في ${where(g)} بلا كود فئة — الفئات: ${raws.slice(0, 5).join("، ")}.`, g.items.map((c) => c.row)));
  });
  grouped(cards.filter((c) => c.company === "")).forEach((g) => {
    issues.push(issue("error", "NO_COMPANY_CODE", g, `${g.items.length} كرت في ${where(g)} بلا كود شركة.`, g.items.map((c) => c.row)));
  });
  return { cards, issues };
}

/* ---------- الفحوص ---------- */

function checkCards(cards, opts) {
  opts = opts || {};
  const issues = [];
  const push = (level, code, list, msg) => grouped(list).forEach((g) => issues.push(issue(level, code, g, msg(g), g.items.map((c) => c.row))));

  push("error", "EMPTY_FIELD", cards.filter((c) => c.pin === "" || c.serial === ""),
    (g) => `${g.items.length} صف في ${where(g)} فيه رقم سري أو سيريال فارغ.`);

  const lost = (c, f) => (c.srcFlags && c.srcFlags[f] && c.srcFlags[f].includes("lossy")) || isScientific(c[f]);
  push("error", "PRECISION_LOST", cards.filter((c) => lost(c, "pin") || lost(c, "serial")),
    (g) => `${g.items.length} رقم في ${where(g)} محفوظ في Excel كرقم وضاعت منه خانات (صيغة علمية أو أكثر من 15 رقمًا) — اطلب من المورد ملفًا تكون فيه الأرقام نصوصًا.`);

  const dated = (c) => ["pin", "serial"].some((f) => c.srcFlags && c.srcFlags[f] && c.srcFlags[f].includes("date"));
  push("warning", "DATE_FORMATTED_ID", cards.filter(dated),
    (g) => `${g.items.length} رقم في ${where(g)} منسّق في Excel كتاريخ فظهر كتاريخ — راجع العمود في الملف الأصلي.`);

  const dupFields = opts.serialFromPin ? ["pin"] : ["pin", "serial"];
  dupFields.forEach((f) => {
    const first = new Map();
    const dups = [];
    cards.forEach((c) => {
      const v = c[f];
      if (v === "") return;
      if (first.has(v)) dups.push(c); else first.set(v, c);
    });
    push("error", f === "pin" ? "DUP_PIN" : "DUP_SERIAL", dups, (g) => {
      const ex = [...new Set(g.items.map((c) => c[f]))].slice(0, 3).map((v) => `"${v}"`).join("، ");
      return `${g.items.length} ${FIELD_NAMES[f]} مكرر في ${where(g)} (ظهر قبل ذلك في نفس الدفعة)، مثل: ${ex}.`;
    });
  });

  ["pin", "serial"].forEach((f) => {
    grouped(cards).forEach((g) => {
      const vals = g.items.filter((c) => c[f] !== "");
      if (vals.length < 3) return;
      const freq = new Map();
      vals.forEach((c) => freq.set(c[f].length, (freq.get(c[f].length) || 0) + 1));
      let mode = 0, best = -1;
      freq.forEach((n, len) => { if (n > best || (n === best && len > mode)) { best = n; mode = len; } });
      const odd = vals.filter((c) => c[f].length !== mode);
      if (odd.length) issues.push(issue("warning", "LENGTH_OUTLIER", g, `${odd.length} ${FIELD_NAMES[f]} في ${where(g)} طوله يخالف الطول المعتاد (${mode}).`, odd.map((c) => c.row)));
    });
  });

  if (opts.digitsOnly) {
    push("warning", "NON_DIGIT", cards.filter((c) => /\D/.test(c.pin) || /\D/.test(c.serial)),
      (g) => `${g.items.length} صف في ${where(g)} فيه حروف أو رموز داخل الرقم السري أو السيريال.`);
  }
  return issues;
}

/* ---------- الإخراج ---------- */

// اقتباس بنفس سلوك csv.writer الافتراضي في Python
function csvCell(v, d) {
  const s = v == null ? "" : String(v);
  return /["\r\n]/.test(s) || s.includes(d) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
const safeName = (s) => String(s).replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").trim() || "-";
const baseName = (name) => String(name || "").split(/[\/\\]/).pop().replace(/\.[^.]+$/, "");

function fillName(pattern, vars) {
  return pattern.replace(/\{(company|category|categoryRaw|part|source|sourceNumber|date)\}/g, (_, k) => vars[k]);
}

function uniquePath(path, used) {
  if (!used.has(path)) { used.add(path); return { path, renamed: false }; }
  const dot = path.lastIndexOf(".");
  const stem = dot > path.lastIndexOf("/") ? path.slice(0, dot) : path;
  const ext = dot > path.lastIndexOf("/") ? path.slice(dot) : "";
  let k = 2;
  while (used.has(`${stem}_${k}${ext}`)) k++;
  const p = `${stem}_${k}${ext}`;
  used.add(p);
  return { path: p, renamed: true };
}

// ملفات الإخراج: مجلد لكل كود شركة، وملف لكل فئة (أو ملف واحد)، مع التقسيم إلى أجزاء.
// meta: { date: "YYYY-MM-DD", usedPaths?: Set } — usedPaths تمنع التصادم بين عدة ملفات إعداد في نفس الأرشيف.
function buildOutputs(cards, output, meta) {
  const used = (meta && meta.usedPaths) || new Set();
  const groups = new Map();
  cards.forEach((c) => {
    const k = JSON.stringify([c.company, output.groupBy === "category" ? c.category : ""]);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(c);
  });
  const files = [];
  const renamed = [];
  const d = output.delimiter;
  const line = (arr) => arr.map((v) => csvCell(v, d)).join(d) + output.lineEnding;
  groups.forEach((list) => {
    const first = list[0];
    const size = output.chunkSize > 0 ? output.chunkSize : list.length;
    for (let start = 0, part = 1; start < list.length; start += size, part++) {
      const chunk = list.slice(start, start + size);
      const vars = {
        company: first.company,
        category: output.groupBy === "category" ? first.category : "",
        categoryRaw: output.groupBy === "category" ? first.categoryRaw : "",
        part: String(part),
        source: baseName(first.file),
        sourceNumber: firstNumber(baseName(first.file)),
        date: (meta && meta.date) || "",
      };
      const folder = safeName(first.company);
      const u = uniquePath(`${folder}/${safeName(fillName(output.fileName, vars))}`, used);
      if (u.renamed) renamed.push(u.path);
      let text = output.header ? line(output.columns) : "";
      chunk.forEach((c) => { text += line(output.columns.map((col) => c[col])); });
      files.push({ company: first.company, category: vars.category, fileName: u.path.slice(folder.length + 1), path: u.path, rows: chunk.length, text, cards: chunk });
    }
  });
  const issues = renamed.length
    ? [{ level: "warning", code: "NAME_COLLISION", message: `نمط اسم الملف أنتج أسماء متطابقة — أُضيف رقم لتمييزها: ${renamed.slice(0, 3).join("، ")}${renamed.length > 3 ? "…" : ""}.`, file: null, sheet: null, rows: [] }]
    : [];
  return { files, issues };
}

function encodeOutput(text, output) {
  const body = new TextEncoder().encode(text);
  if (!output || !output.bom) return body;
  const out = new Uint8Array(body.length + 3);
  out.set([0xef, 0xbb, 0xbf], 0);
  out.set(body, 3);
  return out;
}

function summarize(cards) {
  const map = new Map();
  cards.forEach((c) => {
    const k = JSON.stringify([c.company, c.category]);
    if (!map.has(k)) map.set(k, { company: c.company, category: c.category, count: 0 });
    map.get(k).count++;
  });
  return [...map.values()];
}

// المطابقة: الصفوف المقروءة = الكروت المكتوبة + الصفوف الفارغة المتجاهلة
function reconcile({ readRows, skippedEmpty, cards, files }) {
  const written = files.reduce((a, f) => a + f.rows, 0);
  const ok = written === cards.length && readRows === written + skippedEmpty;
  return {
    ok, readRows, written, skippedEmpty,
    message: ok
      ? `الصفوف المقروءة (${readRows}) = الكروت المكتوبة (${written}) + الصفوف الفارغة (${skippedEmpty}) ✓`
      : `خطأ داخلي في المطابقة: المقروء ${readRows}، المكتوب ${written}، الفارغ ${skippedEmpty}، الكروت ${cards.length} — لن يُسمح بالتنزيل.`,
  };
}

return { missingCategoryCodes, assignCodes, checkCards, buildOutputs, encodeOutput, summarize, reconcile };
});
