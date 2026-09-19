"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./csv.js" ← T.core.csv — نفس سطر require يعمل في المتصفح وفي Node
    T.core.csv = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {

/* ---------- تحليل CSV (متوافق مع RFC 4180) ---------- */

function parseCSV(text, delimiter) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  let fieldHadQuotes = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += c; i++; continue;
    }
    if (c === '"' && field === "" && !fieldHadQuotes) {
      inQuotes = true; fieldHadQuotes = true; i++; continue;
    }
    if (c === delimiter) {
      row.push(field); field = ""; fieldHadQuotes = false; i++; continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row);
      row = []; field = ""; fieldHadQuotes = false; i++; continue;
    }
    field += c; i++;
  }
  if (field !== "" || fieldHadQuotes || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return { rows, unclosedQuote: inQuotes };
}

function detectDelimiter(text) {
  const candidates = [",", ";", "\t", "|"];
  let best = ",";
  let bestScore = -1;
  for (const d of candidates) {
    const { rows } = parseCSV(text.slice(0, 20000), d);
    const sample = rows.filter((r) => r.some((c) => c.trim() !== "")).slice(0, 25);
    if (sample.length === 0) continue;
    const counts = sample.map((r) => r.length);
    const first = counts[0];
    if (first < 2) continue;
    const consistent = counts.filter((c) => c === first).length / counts.length;
    const score = consistent * 10 + first;
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

const DELIM_NAMES = { ",": "فاصلة (,)", ";": "فاصلة منقوطة (;)", "\t": "مسافة جدولة (Tab)", "|": "خط عمودي (|)" };

/* ---------- تصنيف أنواع القيم ---------- */

const NUM_RE = /^[-+]?([\d٠-٩]+([.,][\d٠-٩]+)?|[\d٠-٩]{1,3}(,[\d٠-٩]{3})+(\.[\d٠-٩]+)?)%?$/;
const DATE_RE = /^[\d٠-٩]{1,4}[-\/.][\d٠-٩]{1,2}[-\/.][\d٠-٩]{1,4}([ T].*)?$/;

function classifyValue(v) {
  const t = v.trim();
  if (t === "") return "empty";
  if (NUM_RE.test(t)) return "number";
  if (DATE_RE.test(t)) return "date";
  return "text";
}

const TYPE_NAMES = { number: "أرقام", date: "تواريخ", text: "نصوص" };

// فاصل داخلي (U+001F) لبناء مفاتيح مقارنة الصفوف دون تصادم مع محتوى الخلايا
const SEP = String.fromCharCode(31);

/* ---------- اكتشاف وجود صف عناوين ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// الصف الأول يُعتبر عناوين إلا إذا احتوى أرقامًا أو تواريخ أو بريدًا إلكترونيًا
function detectHasHeader(firstRow) {
  const cells = firstRow.map((c) => c.trim()).filter((c) => c !== "");
  if (cells.length === 0) return true;
  return !cells.some((c) => classifyValue(c) !== "text" || EMAIL_RE.test(c));
}

// عدد الأعمدة الأكثر شيوعًا بين الصفوف (للملفات بدون صف عناوين)
function modeColumnCount(rows) {
  const freq = new Map();
  rows.forEach((r) => freq.set(r.length, (freq.get(r.length) || 0) + 1));
  let best = 1, bestN = 0;
  freq.forEach((n, len) => { if (n > bestN || (n === bestN && len > best)) { bestN = n; best = len; } });
  return best;
}

/* ---------- تحليل ملف واحد ---------- */

function analyzeFile(name, text, opts, hasHeaderOverride) {
  const issues = [];
  const delimiter = detectDelimiter(text);
  const { rows: rawRows, unclosedQuote } = parseCSV(text, delimiter);
  if (unclosedQuote) {
    issues.push({ severity: "error", file: name, message: `علامة اقتباس (") غير مغلقة في الملف "${name}" — قد يكون الملف تالفًا وقد تكون نتائج الدمج غير دقيقة.` });
  }
  return analyzeRows(name, rawRows, opts, hasHeaderOverride, { delimiter, issues });
}

// تحليل صفوف مُحلَّلة مسبقًا (مصدرها CSV أو ورقة Excel) — نفس منطق analyzeFile.
// meta: { delimiter, issues, excel } حيث excel = { sheetName } للملفات القادمة من Excel (بلا فاصل CSV).
function analyzeRows(name, rawRows, opts, hasHeaderOverride, meta) {
  meta = meta || {};
  const issues = meta.issues ? meta.issues.slice() : [];
  const delimiter = meta.delimiter != null ? meta.delimiter : null;
  const excel = meta.excel || null;

  if (rawRows.length === 0 || rawRows.every((r) => r.every((c) => (c == null ? "" : String(c)).trim() === ""))) {
    issues.push({ severity: "error", file: name, message: `الملف "${name}" فارغ تمامًا — سيتم تجاهله في الدمج.` });
    return { name, delimiter, excel, headers: [], dataRows: [], issues, empty: true, hasHeader: true };
  }

  // أول صف غير فارغ
  let headerIdx = 0;
  while (headerIdx < rawRows.length && rawRows[headerIdx].every((c) => c.trim() === "")) headerIdx++;

  // هل يوجد صف عناوين؟ (اكتشاف تلقائي مع إمكانية التحكم اليدوي لكل ملف)
  const headerDetected = detectHasHeader(rawRows[headerIdx]);
  const hasHeader = hasHeaderOverride == null ? headerDetected : hasHeaderOverride;

  const headers = [];
  let rawHeaders = null;
  let dataStart;

  if (hasHeader) {
    rawHeaders = rawRows[headerIdx];
    dataStart = headerIdx + 1;
    const seen = new Map();
    rawHeaders.forEach((h, i) => {
      let clean = h.trim();
      if (clean !== h && clean !== "") {
        issues.push({ severity: "info", file: name, message: `عنوان العمود "${clean}" في "${name}" يحتوي مسافات زائدة في بدايته أو نهايته — تم تنظيفه تلقائيًا.` });
      }
      if (clean === "") {
        clean = `عمود_${i + 1}`;
        issues.push({ severity: "warn", file: name, message: `عمود بدون عنوان في "${name}" (العمود رقم ${i + 1}) — سُمّي "${clean}" تلقائيًا.` });
      }
      const key = clean;
      if (seen.has(key)) {
        const n2 = seen.get(key) + 1;
        seen.set(key, n2);
        issues.push({ severity: "warn", file: name, message: `اسم العمود "${clean}" مكرر في "${name}" — أُعيدت تسمية النسخة الثانية إلى "${clean} (${n2})".` });
        clean = `${clean} (${n2})`;
      } else {
        seen.set(key, 1);
      }
      headers.push(clean);
    });
  } else {
    // ملف بدون صف عناوين: كل الصفوف بيانات، والأعمدة تُعرَّف بموقعها
    dataStart = headerIdx;
    const contentRows = rawRows.slice(headerIdx).filter((r) => r.some((c) => c.trim() !== ""));
    const colCount = modeColumnCount(contentRows);
    for (let i = 0; i < colCount; i++) headers.push(`عمود_${i + 1}`);
    if (hasHeaderOverride == null) {
      issues.push({ severity: "info", file: name, message: `الملف "${name}" بدون صف عناوين (اكتُشف تلقائيًا لأن الصف الأول يبدو بيانات) — كل صفوفه ستُعامل كبيانات، ويمكنك تغيير ذلك من بطاقة الملف.` });
    }
  }

  // صفوف البيانات
  const dataRows = [];
  let emptyRowCount = 0;
  const raggedRows = [];
  const repeatedHeaderRows = [];

  for (let r = dataStart; r < rawRows.length; r++) {
    const row = rawRows[r];
    const lineNo = r + 1; // رقم الصف كما يراه المستخدم في الملف الأصلي
    const isEmpty = row.every((c) => c.trim() === "");
    if (isEmpty) { emptyRowCount++; if (!opts.skipEmpty) dataRows.push(new Array(headers.length).fill("")); continue; }

    // صف عناوين مكرر داخل البيانات → غالبًا جدول إضافي مدموج في نفس الملف
    if (hasHeader && row.length === rawHeaders.length && row.every((c, i) => c.trim() === rawHeaders[i].trim())) {
      repeatedHeaderRows.push(lineNo);
      continue;
    }

    if (row.length !== headers.length) {
      raggedRows.push({ line: lineNo, got: row.length, expected: headers.length });
      const fixed = row.slice(0, headers.length);
      while (fixed.length < headers.length) fixed.push("");
      dataRows.push(fixed);
    } else {
      dataRows.push(row.slice());
    }
  }

  if (repeatedHeaderRows.length > 0) {
    issues.push({
      severity: "warn", file: name,
      message: `صف العناوين مكرر داخل بيانات "${name}" (الصف ${repeatedHeaderRows.slice(0, 5).join("، ")}${repeatedHeaderRows.length > 5 ? " وغيرها" : ""}) — يبدو أن الملف يحتوي على أكثر من جدول مدموج فوق بعضها. تم استبعاد صفوف العناوين المكررة من الدمج، راجع الملف الأصلي للتأكد.`,
    });
  }
  if (raggedRows.length > 0) {
    const examples = raggedRows.slice(0, 5)
      .map((x) => `الصف ${x.line} (${x.got} من ${x.expected})`).join("، ");
    issues.push({
      severity: "error", file: name,
      message: `${raggedRows.length} صف في "${name}" عدد حقوله لا يطابق عدد الأعمدة (${headers.length}): ${examples}${raggedRows.length > 5 ? " وغيرها" : ""} — الحقول الزائدة ستُقتص والناقصة ستُملأ بقيم فارغة. غالبًا السبب فاصلة داخل نص غير محاط بعلامات اقتباس.`,
    });
  }
  if (emptyRowCount > 0) {
    issues.push({
      severity: "info", file: name,
      message: `${emptyRowCount} صف فارغ في "${name}"${opts.skipEmpty ? " — سيتم تجاهلها." : " — سيتم تضمينها (يمكنك تفعيل خيار تجاهل الصفوف الفارغة)."}`,
    });
  }

  // اتساق نوع البيانات في كل عمود
  for (let c = 0; c < headers.length; c++) {
    const typed = [];
    for (let r = 0; r < dataRows.length; r++) {
      const v = dataRows[r][c];
      const cls = classifyValue(v == null ? "" : v);
      if (cls !== "empty") typed.push({ cls, value: v.trim(), line: r });
    }
    if (typed.length < 5) continue;
    const counts = {};
    typed.forEach((t) => { counts[t.cls] = (counts[t.cls] || 0) + 1; });
    const dominant = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
    const share = counts[dominant] / typed.length;
    if (share >= 0.85 && share < 1 && (dominant === "number" || dominant === "date")) {
      const outliers = typed.filter((t) => t.cls !== dominant).slice(0, 3)
        .map((t) => `"${t.value.length > 30 ? t.value.slice(0, 30) + "…" : t.value}"`).join("، ");
      issues.push({
        severity: "warn", file: name,
        message: `العمود "${headers[c]}" في "${name}" يحتوي ${TYPE_NAMES[dominant]} في الغالب لكن توجد قيم شاذة مثل: ${outliers} — تحقق من صحة هذه القيم.`,
      });
    }
  }

  // صفوف مكررة داخل نفس الملف
  const rowKeys = new Map();
  let dupInFile = 0;
  dataRows.forEach((row) => {
    const key = row.join(SEP);
    if (row.every((c) => c.trim() === "")) return;
    rowKeys.set(key, (rowKeys.get(key) || 0) + 1);
  });
  rowKeys.forEach((count) => { if (count > 1) dupInFile += count - 1; });
  if (dupInFile > 0) {
    issues.push({
      severity: "warn", file: name,
      message: `${dupInFile} صف مكرر بالكامل داخل "${name}"${opts.dropDupes ? " — سيتم الاحتفاظ بنسخة واحدة فقط." : " — يمكنك تفعيل خيار إزالة الصفوف المكررة لحذفها."}`,
    });
  }

  return { name, delimiter, excel, headers, dataRows, issues, empty: false, rowCount: dataRows.length, hasHeader };
}

/* ---------- الفحوصات بين الملفات ---------- */

function normalizeHeader(h, caseInsensitive) {
  return caseInsensitive ? h.trim().toLowerCase() : h.trim();
}

function crossFileChecks(files, opts) {
  const issues = [];
  const usable = files.filter((f) => !f.empty);
  if (usable.length < 2) return issues;

  const ci = opts.caseInsensitive;
  const named = usable.filter((f) => f.hasHeader);

  // كل الملفات بدون صف عناوين: قارن عدد الأعمدة فقط
  if (named.length === 0) {
    const counts = new Set(usable.map((f) => f.headers.length));
    if (counts.size > 1) {
      issues.push({
        severity: "warn", file: null,
        message: `عدد الأعمدة يختلف بين الملفات (${[...counts].join("، ")}) رغم أنها كلها بدون صف عناوين — تأكد أن الملفات من نفس البنية قبل الدمج.`,
      });
    }
  }

  // أعمدة متطابقة باختلاف حالة الأحرف فقط (بين الملفات ذات العناوين)
  if (!ci && named.length >= 2) {
    const variants = new Map();
    named.forEach((f) => f.headers.forEach((h) => {
      const key = h.toLowerCase();
      if (!variants.has(key)) variants.set(key, new Set());
      variants.get(key).add(h);
    }));
    variants.forEach((set) => {
      if (set.size > 1) {
        issues.push({
          severity: "warn", file: null,
          message: `الأعمدة ${[...set].map((v) => `"${v}"`).join(" و ")} تبدو نفس العمود باختلاف حالة الأحرف فقط — فعِّل خيار "تجاهل حالة الأحرف" لدمجها في عمود واحد.`,
        });
      }
    });
  }

  // مقارنة مجموعات الأعمدة: أعمدة إضافية أو ناقصة بين الملفات ذات العناوين
  const allCols = new Map(); // normalized → { display, files: Set }
  named.forEach((f) => f.headers.forEach((h) => {
    const key = normalizeHeader(h, ci);
    if (!allCols.has(key)) allCols.set(key, { display: h, files: new Set() });
    allCols.get(key).files.add(f.name);
  }));

  let schemaMismatch = false;
  allCols.forEach((col) => {
    if (named.length >= 2 && col.files.size < named.length) {
      schemaMismatch = true;
      const inFiles = [...col.files];
      const missingFrom = named.map((f) => f.name).filter((n) => !col.files.has(n));
      if (inFiles.length === 1) {
        issues.push({
          severity: "warn", file: null,
          message: `العمود "${col.display}" موجود في "${inFiles[0]}" فقط — ${opts.columnMode === "union" ? "سيُضاف للناتج وتُملأ قيمه بفراغات لبقية الملفات." : "سيُستبعد من الناتج لأنك اخترت الأعمدة المشتركة فقط."}`,
        });
      } else {
        issues.push({
          severity: "warn", file: null,
          message: `العمود "${col.display}" غير موجود في: ${missingFrom.map((n) => `"${n}"`).join("، ")} — ${opts.columnMode === "union" ? "ستُملأ قيمه بفراغات لهذه الملفات." : "سيُستبعد من الناتج."}`,
        });
      }
    }
  });

  // نفس الأعمدة لكن بترتيب مختلف
  if (!schemaMismatch && named.length >= 2) {
    const ref = named[0].headers.map((h) => normalizeHeader(h, ci)).join(SEP);
    const orderDiffers = named.some((f) => f.headers.map((h) => normalizeHeader(h, ci)).join(SEP) !== ref);
    if (orderDiffers) {
      issues.push({
        severity: "info", file: null,
        message: "ترتيب الأعمدة يختلف بين الملفات — لا مشكلة، ستتم محاذاة البيانات حسب اسم العمود تلقائيًا وليس حسب موقعه.",
      });
    }
  }

  // اختلاف الفواصل بين الملفات (ملفات CSV فقط — ملفات Excel لا فاصل نصيًّا لها)
  const csvUsable = usable.filter((f) => !f.excel && f.delimiter != null);
  const delims = new Set(csvUsable.map((f) => f.delimiter));
  if (delims.size > 1) {
    issues.push({
      severity: "info", file: null,
      message: `الملفات تستخدم فواصل مختلفة (${[...delims].map((d) => DELIM_NAMES[d]).join("، ")}) — تم اكتشاف كل فاصل تلقائيًا وسيَستخدم الناتج الفاصلة القياسية (,).`,
    });
  }

  return issues;
}


/* ---------- توليد CSV ---------- */

function csvEscape(value, delimiter) {
  const v = value == null ? "" : String(value);
  if (v.includes('"') || v.includes(delimiter) || v.includes("\n") || v.includes("\r")) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

// مرِّر null بدل headers لإنتاج CSV بدون صف عناوين
function toCSV(headers, rows, delimiter) {
  const lines = [];
  if (headers && headers.length > 0) lines.push(headers.map((h) => csvEscape(h, delimiter)).join(delimiter));
  rows.forEach((r) => lines.push(r.map((c) => csvEscape(c, delimiter)).join(delimiter)));
  return lines.join("\r\n");
}

/* ---------- قراءة الملف مع اكتشاف الترميز ---------- */

async function readFileSmart(file) {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  let encoding = "utf-8";
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";

  let text;
  let fallback = false;
  try {
    text = new TextDecoder(encoding, { fatal: encoding === "utf-8" }).decode(buf);
  } catch (e) {
    // ليس UTF-8 صالحًا — الأرجح ترميز ويندوز العربي (شائع في ملفات Excel القديمة)
    text = new TextDecoder("windows-1256").decode(buf);
    fallback = true;
  }
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return { text, fallback, encoding: fallback ? "windows-1256" : encoding };
}

return { parseCSV, detectDelimiter, DELIM_NAMES, classifyValue, TYPE_NAMES, SEP, detectHasHeader, modeColumnCount, analyzeFile, analyzeRows, normalizeHeader, crossFileChecks, csvEscape, toCSV, readFileSmart };
});
