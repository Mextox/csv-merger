"use strict";

/* =====================================================================
 * دمج ملفات CSV — كل المعالجة تتم داخل المتصفح، لا يُرفع أو يُخزَّن أي شيء.
 * القسم الأول: دوال نقيّة (تحليل، فحص، دمج) — القسم الثاني: واجهة المستخدم.
 * ===================================================================== */

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
  if (rawRows.length === 0 || rawRows.every((r) => r.every((c) => c.trim() === ""))) {
    issues.push({ severity: "error", file: name, message: `الملف "${name}" فارغ تمامًا — سيتم تجاهله في الدمج.` });
    return { name, delimiter, headers: [], dataRows: [], issues, empty: true, hasHeader: true };
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

  return { name, delimiter, headers, dataRows, issues, empty: false, rowCount: dataRows.length, hasHeader };
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

  // اختلاف الفواصل بين الملفات
  const delims = new Set(usable.map((f) => f.delimiter));
  if (delims.size > 1) {
    issues.push({
      severity: "info", file: null,
      message: `الملفات تستخدم فواصل مختلفة (${[...delims].map((d) => DELIM_NAMES[d]).join("، ")}) — تم اكتشاف كل فاصل تلقائيًا وسيَستخدم الناتج الفاصلة القياسية (,).`,
    });
  }

  return issues;
}

/* ---------- الدمج ---------- */

const POS_PREFIX = " pos_"; // مفتاح خاص للأعمدة الموضعية حتى لا يتصادم مع أسماء أعمدة حقيقية

// تحدد أعمدة الناتج (المفاتيح + عناوين العرض) وهل يُكتب صف عناوين.
// ok=false يعني تعذّر الدمج (لا توجد أعمدة مشتركة في وضع التقاطع).
function planColumns(files, opts) {
  const usable = files.filter((f) => !f.empty);
  const ci = opts.caseInsensitive;
  const named = usable.filter((f) => f.hasHeader);
  const headerless = usable.filter((f) => !f.hasHeader);
  const includeHeader = named.length > 0;
  const issues = [];
  let finalCols = []; // مفاتيح: أسماء مطبَّعة أو مفاتيح موضعية
  let headers = [];   // أسماء العرض
  let ok = true;

  if (named.length > 0) {
    // الأعمدة تُبنى من الملفات ذات العناوين
    const colOrder = [];
    const colDisplay = new Map();
    named.forEach((f) => f.headers.forEach((h) => {
      const key = normalizeHeader(h, ci);
      if (!colDisplay.has(key)) { colDisplay.set(key, h.trim()); colOrder.push(key); }
    }));

    finalCols = colOrder;
    if (opts.columnMode === "intersection" && named.length > 1) {
      finalCols = colOrder.filter((key) =>
        named.every((f) => f.headers.some((h) => normalizeHeader(h, ci) === key))
      );
      if (finalCols.length === 0) {
        issues.push({ severity: "error", file: null, message: "لا توجد أعمدة مشتركة بين كل الملفات — لا يمكن الدمج بوضع الأعمدة المشتركة. جرّب وضع اتحاد كل الأعمدة." });
        ok = false;
      }
    }
    headers = finalCols.map((key) => colDisplay.get(key));

    // ملفات بدون عناوين وسط ملفات ذات عناوين: محاذاة موضعية + أعمدة إضافية عند الحاجة
    if (ok && headerless.length > 0) {
      if (opts.columnMode === "union") {
        const maxHl = Math.max(...headerless.map((f) => f.headers.length));
        while (finalCols.length < maxHl) {
          headers.push(`عمود_${finalCols.length + 1}`);
          finalCols.push(POS_PREFIX + finalCols.length);
        }
      }
      headerless.forEach((f) => {
        issues.push({
          severity: "warn", file: f.name,
          message: `الملف "${f.name}" بدون صف عناوين — تمت محاذاة أعمدته حسب الموقع مع ترتيب أعمدة الناتج. تأكد من أن ترتيب أعمدته يطابق بقية الملفات.`,
        });
      });
    }
  } else if (usable.length > 0) {
    // كل الملفات بدون صف عناوين: محاذاة موضعية بالكامل وبدون صف عناوين في الناتج
    const counts = usable.map((f) => f.headers.length);
    const colCount = opts.columnMode === "intersection" ? Math.min(...counts) : Math.max(...counts);
    for (let i = 0; i < colCount; i++) {
      finalCols.push(POS_PREFIX + i);
      headers.push(`عمود ${i + 1}`);
    }
    issues.push({
      severity: "info", file: null,
      message: "كل الملفات بدون صف عناوين — سيتم الدمج بمحاذاة الأعمدة حسب موقعها، ولن يُضاف صف عناوين إلى الملف الناتج.",
    });
  }

  return { finalCols, headers, includeHeader, issues, ok, usable };
}

// خريطة الأعمدة الافتراضية لملف واحد: map[outputIndex] = فهرس عمود الملف أو null.
// بالاسم للملفات ذات الرأس، وبالموقع لبقية الملفات.
function defaultFileMap(f, finalCols, ci) {
  const idxOf = new Map();
  if (f.hasHeader) {
    f.headers.forEach((h, i) => {
      const key = normalizeHeader(h, ci);
      if (!idxOf.has(key)) idxOf.set(key, i);
    });
  }
  return finalCols.map((key, pos) => {
    let i;
    if (!f.hasHeader) i = pos < f.headers.length ? pos : null; // ملف بدون عناوين: محاذاة بالموقع
    else if (key.startsWith(POS_PREFIX)) i = null;             // عمود موضعي لا يخص الملفات ذات العناوين
    else { const v = idxOf.get(key); i = v == null ? null : v; }
    return i == null ? null : i;
  });
}

// خطة الدمج التلقائية: أعمدة الناتج + خريطة أعمدة لكل ملف قابل للاستخدام.
function autoMergePlan(files, opts) {
  const p = planColumns(files, opts);
  const ci = opts.caseInsensitive;
  const maps = p.ok ? p.usable.map((f) => defaultFileMap(f, p.finalCols, ci)) : [];
  return { finalCols: p.finalCols, headers: p.headers, includeHeader: p.includeHeader, maps, issues: p.issues, ok: p.ok };
}

// يجمّع صفوف الدمج بتطبيق خرائط الأعمدة لكل ملف — القلب النقي القابل للاختبار.
// finalCols/headers: أعمدة الناتج بترتيبها الحالي. maps: بموازاة الملفات، map[outputPos] = فهرس عمود الملف أو null.
function assembleRows(usable, opts, finalCols, headers, includeHeader, maps) {
  const issues = [];
  const rows = [];
  const sources = []; // فهرس الملف المصدر لكل صف (بموازاة usable) — يُستخدم للتلوين
  const seenKeys = new Map();
  let droppedDupes = 0;
  let crossDupes = 0;
  const SOURCE_COL = "الملف المصدر";
  const outHeaders = opts.addSource ? headers.concat(SOURCE_COL) : headers.slice();

  usable.forEach((f, fi) => {
    const map = maps[fi] || [];
    f.dataRows.forEach((raw) => {
      const out = finalCols.map((_, pos) => {
        const i = map[pos];
        return i == null ? "" : (raw[i] == null ? "" : raw[i]);
      });
      const dataKey = out.join(SEP);
      const prevSource = seenKeys.get(dataKey);
      if (prevSource !== undefined) {
        if (prevSource !== f.name) crossDupes++;
        if (opts.dropDupes) { droppedDupes++; return; }
      } else {
        seenKeys.set(dataKey, f.name);
      }
      if (opts.addSource) out.push(f.name);
      rows.push(out);
      sources.push(fi);
    });
  });

  if (crossDupes > 0 && !opts.dropDupes) {
    issues.push({
      severity: "info", file: null,
      message: `وُجد ${crossDupes} صف متطابق بين ملفات مختلفة — إن كان هذا تكرارًا غير مقصود فعِّل خيار "إزالة الصفوف المكررة".`,
    });
  }

  // أعمدة فارغة تمامًا في الناتج
  for (let c = 0; c < finalCols.length; c++) {
    if (rows.length > 0 && rows.every((r) => (r[c] || "").trim() === "")) {
      issues.push({ severity: "info", file: null, message: `العمود "${headers[c]}" فارغ تمامًا في الناتج المدموج — قد ترغب في حذفه من الملفات الأصلية.` });
    }
  }

  return { headers: outHeaders, rows, sources, issues, droppedDupes, crossDupes, includeHeader };
}

// يطبّق خطة (أعمدة + خرائط، بترتيب قد يكون معدّلًا يدويًا) على الملفات — دالة نقية قابلة للاختبار.
function mergeWithMaps(files, opts, plan) {
  const usable = files.filter((f) => !f.empty);
  return assembleRows(usable, opts, plan.finalCols, plan.headers, plan.includeHeader, plan.maps);
}

// الدمج التلقائي الكامل (يحافظ على سلوك buildMerge السابق تمامًا عبر التفويض للخطة التلقائية).
function buildMerge(files, opts) {
  const plan = autoMergePlan(files, opts);
  if (!plan.ok) {
    return { headers: [], rows: [], issues: plan.issues, droppedDupes: 0, crossDupes: 0, includeHeader: plan.includeHeader };
  }
  const asm = mergeWithMaps(files, opts, plan);
  return {
    headers: asm.headers,
    rows: asm.rows,
    issues: plan.issues.concat(asm.issues),
    droppedDupes: asm.droppedDupes,
    crossDupes: asm.crossDupes,
    includeHeader: asm.includeHeader,
  };
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

/* =====================================================================
 * واجهة المستخدم
 * ===================================================================== */

if (typeof document !== "undefined") {
  const $ = (id) => document.getElementById(id);

  const state = { files: [] }; // { id, name, size, text, hasHeaderOverride, encodingNote }
  let fileSeq = 0; // مُعرِّف ثابت لكل ملف حتى يبقى لونه ثابتًا عند إضافة/حذف ملفات أخرى

  const dropzone = $("dropzone");
  const fileInput = $("fileInput");

  /* ---------- ألوان الملفات ---------- */

  // لوحة ألوان لطيفة متمايزة تتكرر دوريًا (7 ألوان)
  const PALETTE = ["#6366f1", "#10b981", "#f59e0b", "#f43f5e", "#0ea5e9", "#8b5cf6", "#14b8a6"];
  function hexToRgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  function colorFor(id) {
    const solid = PALETTE[id % PALETTE.length];
    return { solid, tint: hexToRgba(solid, 0.1) };
  }
  // ألوان الملفات القابلة للاستخدام (غير الفارغة) بترتيبها، لمطابقة فهارس usable
  function usableColorsOf(analyzed, colors) {
    const out = [];
    analyzed.forEach((a, i) => { if (!a.empty) out.push(colors[i]); });
    return out;
  }

  /* ---------- حالة محاذاة الأعمدة (خرائط قابلة للتعديل بالسحب) ---------- */

  // finalCols/headers/maps بالترتيب الحالي؛ maps[fi][outputPos] = فهرس عمود الملف أو null.
  const align = { signature: "", ok: false, includeHeader: true, finalCols: [], headers: [], maps: [] };

  // بصمة تعتمد على البُنية التي تحدد شكل الأعمدة؛ أي تغيّر جوهري يعيد بناء الخرائط بأمان
  function alignSignature(analyzed, opts) {
    const usable = analyzed.filter((a) => !a.empty);
    return JSON.stringify({
      files: usable.map((a) => ({ n: a.name, h: a.hasHeader, cols: a.headers })),
      mode: opts.columnMode,
      ci: opts.caseInsensitive,
    });
  }

  // يعيد بناء الخرائط تلقائيًا عند أول مرة أو عند تغيّر البُنية جوهريًا
  function syncAlign(analyzed, opts) {
    const sig = alignSignature(analyzed, opts);
    if (sig === align.signature) return;
    const plan = autoMergePlan(analyzed, opts);
    align.signature = sig;
    align.ok = plan.ok;
    align.includeHeader = plan.includeHeader;
    align.finalCols = plan.finalCols.slice();
    align.headers = plan.headers.slice();
    align.maps = plan.maps.map((m) => m.slice());
    align.active = false; // لا يوجد تخصيص يدوي بعد
  }

  function moveInArray(arr, from, to) {
    const [x] = arr.splice(from, 1);
    arr.splice(to, 0, x);
  }

  // إعادة ترتيب أعمدة الناتج (سحب رؤوس جدول المعاينة): يحرّك العمود لكل الملفات معًا
  function moveOutputColumn(from, to) {
    if (from === to) return;
    moveInArray(align.finalCols, from, to);
    moveInArray(align.headers, from, to);
    align.maps.forEach((m) => moveInArray(m, from, to));
    align.active = true;
    render();
  }

  // إعادة توجيه أعمدة ملف واحد (سحب رؤوس جدوله المصغّر): يعدّل خريطة هذا الملف فقط
  function moveFileColumn(fi, from, to) {
    if (from === to || !align.maps[fi]) return;
    moveInArray(align.maps[fi], from, to);
    align.active = true;
    render();
  }

  // إعادة الخرائط للوضع التلقائي
  function resetAlign() {
    align.signature = ""; // يفرض إعادة البناء في render التالية
    render();
  }

  // تفعيل السحب والإفلات على مجموعة رؤوس أعمدة (HTML5 DnD) مع تلميح بصري
  function enableColDrag(cells, onDrop) {
    let dragFrom = null;
    cells.forEach((th) => {
      th.draggable = true;
      th.addEventListener("dragstart", (e) => {
        dragFrom = Number(th.dataset.col);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(dragFrom)); // مطلوب لبعض المتصفحات
        th.classList.add("col-dragging");
      });
      th.addEventListener("dragend", () => {
        th.classList.remove("col-dragging");
        cells.forEach((c) => c.classList.remove("col-drop-target"));
      });
      th.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        th.classList.add("col-drop-target");
      });
      th.addEventListener("dragleave", () => th.classList.remove("col-drop-target"));
      th.addEventListener("drop", (e) => {
        e.preventDefault();
        th.classList.remove("col-drop-target");
        const from = dragFrom != null ? dragFrom : Number(e.dataTransfer.getData("text/plain"));
        const to = Number(th.dataset.col);
        if (!Number.isNaN(from) && !Number.isNaN(to)) onDrop(from, to);
        dragFrom = null;
      });
    });
  }

  function getOptions() {
    return {
      columnMode: $("optColumnMode").value,
      skipEmpty: $("optSkipEmpty").checked,
      dropDupes: $("optDropDupes").checked,
      caseInsensitive: $("optCaseInsensitive").checked,
      addSource: $("optAddSource").checked,
    };
  }

  function formatSize(bytes) {
    if (bytes < 1024) return bytes + " بايت";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " ك.ب";
    return (bytes / (1024 * 1024)).toFixed(1) + " م.ب";
  }

  async function addFiles(fileList) {
    for (const f of fileList) {
      const lower = f.name.toLowerCase();
      if (!lower.endsWith(".csv") && !lower.endsWith(".txt") && !(f.type || "").includes("csv") && !(f.type || "").includes("text")) {
        alert(`"${f.name}" ليس ملف CSV — الرجاء اختيار ملفات بامتداد .csv`);
        continue;
      }
      if (state.files.some((x) => x.name === f.name && x.size === f.size)) continue; // نفس الملف مضاف مسبقًا
      const { text, fallback, encoding } = await readFileSmart(f);
      state.files.push({
        id: fileSeq++,
        name: f.name,
        size: f.size,
        text,
        hasHeaderOverride: null, // null = اكتشاف تلقائي

        encodingNote: fallback
          ? { severity: "info", file: f.name, message: `الملف "${f.name}" ليس بترميز UTF-8 — تم اكتشاف ترميز ${encoding} وتحويله تلقائيًا حتى لا تظهر الحروف العربية مشوهة.` }
          : null,
      });
    }
    render();
  }

  function removeFile(idx) {
    state.files.splice(idx, 1);
    render();
  }

  /* ---------- التصيير ---------- */

  let lastMerge = null;

  function render() {
    const has = state.files.length > 0;
    $("filesSection").hidden = !has;
    $("optionsSection").hidden = !has;
    $("alignSection").hidden = !has;
    $("issuesSection").hidden = !has;
    $("resultSection").hidden = !has;
    if (!has) { lastMerge = null; align.signature = ""; return; }

    const opts = getOptions();

    // تحليل كل ملف
    const analyzed = state.files.map((f) => {
      const a = analyzeFile(f.name, f.text, opts, f.hasHeaderOverride);
      if (f.encodingNote) a.issues.push(f.encodingNote);
      a.size = f.size;
      return a;
    });
    const colors = state.files.map((f) => colorFor(f.id));

    // أعِد بناء خرائط المحاذاة إن تغيّرت البُنية جوهريًا، وإلا احتفظ بتعديلات المستخدم
    syncAlign(analyzed, opts);

    // الخطة التلقائية (لرسائل الفحص المتعلقة بالأعمدة)، والدمج بالخرائط الحالية (قد تكون معدّلة)
    const plan = autoMergePlan(analyzed, opts);
    const merge = align.ok
      ? mergeWithMaps(analyzed, opts, align)
      : { headers: [], rows: [], sources: [], issues: [], droppedDupes: 0, crossDupes: 0, includeHeader: align.includeHeader };

    const allIssues = [
      ...analyzed.flatMap((a) => a.issues),
      ...crossFileChecks(analyzed, opts),
      ...plan.issues,
      ...merge.issues,
    ];
    const order = { error: 0, warn: 1, info: 2 };
    allIssues.sort((a, b) => order[a.severity] - order[b.severity]);
    lastMerge = merge;

    renderFiles(analyzed, colors);
    renderAlign(analyzed, colors);
    renderIssues(allIssues);
    renderResult(merge, analyzed, allIssues, colors);
  }

  function renderFiles(analyzed, colors) {
    $("filesCount").textContent = analyzed.length;
    const list = $("filesList");
    list.innerHTML = "";
    analyzed.forEach((a, idx) => {
      const errors = a.issues.filter((i) => i.severity === "error").length;
      const warns = a.issues.filter((i) => i.severity === "warn").length;

      const card = document.createElement("div");
      card.className = "file-card";
      card.style.setProperty("--file-color", colors[idx].solid); // شريط جانبي بلون الملف

      const icon = document.createElement("span");
      icon.className = "file-icon";
      icon.textContent = "📄";

      const info = document.createElement("div");
      info.className = "file-info";
      const nameEl = document.createElement("div");
      nameEl.className = "file-name";
      nameEl.textContent = a.name;
      const meta = document.createElement("div");
      meta.className = "file-meta";
      if (a.empty) {
        meta.textContent = "ملف فارغ";
      } else {
        [`${formatSize(a.size)}`, `${a.rowCount} صف`, `${a.headers.length} عمود`, `الفاصل: ${DELIM_NAMES[a.delimiter]}`]
          .forEach((t) => { const s = document.createElement("span"); s.textContent = t; meta.appendChild(s); });
      }
      info.appendChild(nameEl);
      info.appendChild(meta);

      const flags = document.createElement("div");
      flags.className = "file-flags";
      if (errors > 0) { const f = document.createElement("span"); f.className = "flag flag-error"; f.textContent = `${errors} خطأ`; flags.appendChild(f); }
      if (warns > 0) { const f = document.createElement("span"); f.className = "flag flag-warn"; f.textContent = `${warns} تحذير`; flags.appendChild(f); }
      if (errors === 0 && warns === 0) { const f = document.createElement("span"); f.className = "flag flag-ok"; f.textContent = "سليم ✓"; flags.appendChild(f); }

      const rm = document.createElement("button");
      rm.className = "file-remove";
      rm.title = "إزالة الملف";
      rm.textContent = "✕";
      rm.addEventListener("click", () => removeFile(idx));

      card.appendChild(icon);
      card.appendChild(info);
      if (!a.empty) {
        const hdrToggle = document.createElement("label");
        hdrToggle.className = "hdr-toggle";
        hdrToggle.title = "هل الصف الأول في هذا الملف صف عناوين؟ يُكتشف تلقائيًا ويمكنك تصحيحه هنا";
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = a.hasHeader;
        cb.addEventListener("change", () => { state.files[idx].hasHeaderOverride = cb.checked; render(); });
        hdrToggle.appendChild(cb);
        hdrToggle.appendChild(document.createTextNode(" الصف الأول عناوين"));
        card.appendChild(hdrToggle);
      }
      card.appendChild(flags);
      card.appendChild(rm);
      list.appendChild(card);
    });
  }

  const SEV_LABELS = { error: "خطأ", warn: "تحذير", info: "ملاحظة" };

  function renderIssues(issues) {
    $("issuesCount").textContent = issues.length;
    $("issuesClean").hidden = issues.length !== 0;
    const list = $("issuesList");
    list.innerHTML = "";
    issues.forEach((iss) => {
      const li = document.createElement("li");
      li.className = `issue issue-${iss.severity}`;
      const sev = document.createElement("span");
      sev.className = "sev";
      sev.textContent = SEV_LABELS[iss.severity];
      const msg = document.createElement("span");
      msg.textContent = iss.message;
      li.appendChild(sev);
      li.appendChild(msg);
      list.appendChild(li);
    });
  }

  const PREVIEW_LIMIT = 100;

  function renderResult(merge, analyzed, allIssues, colors) {
    const stats = $("resultStats");
    stats.innerHTML = "";
    const usable = analyzed.filter((a) => !a.empty);
    const usableColors = usableColorsOf(analyzed, colors);
    renderLegend(analyzed, colors);
    const items = [
      [`${usable.length}`, "ملف"],
      [`${merge.rows.length}`, "صف مدموج"],
      [`${merge.headers.length}`, "عمود"],
    ];
    if (merge.droppedDupes > 0) items.push([`${merge.droppedDupes}`, "صف مكرر حُذف"]);
    const errCount = allIssues.filter((i) => i.severity === "error").length;
    items.push([`${errCount}`, "خطأ يحتاج مراجعة"]);
    items.forEach(([num, label]) => {
      const d = document.createElement("div");
      d.className = "stat";
      const b = document.createElement("b");
      b.textContent = num;
      d.appendChild(b);
      d.appendChild(document.createTextNode(" " + label));
      stats.appendChild(d);
    });

    // معاينة الجدول — رؤوس أعمدة الناتج قابلة للسحب لإعادة الترتيب، وكل صف بلون ملفه المصدر
    const table = $("previewTable");
    table.innerHTML = "";
    if (merge.headers.length > 0) {
      const draggableCount = align.finalCols.length; // العمود الأخير (الملف المصدر) غير قابل للسحب
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      const headerCells = [];
      merge.headers.forEach((h, ci) => {
        const th = document.createElement("th");
        th.textContent = h;
        if (!merge.includeHeader && ci < draggableCount) th.classList.add("th-generic");
        if (ci < draggableCount) {
          th.classList.add("th-draggable");
          th.dataset.col = ci;
          th.title = "اسحب لإعادة ترتيب أعمدة الناتج";
          headerCells.push(th);
        }
        trh.appendChild(th);
      });
      thead.appendChild(trh);
      table.appendChild(thead);
      enableColDrag(headerCells, (from, to) => moveOutputColumn(from, to));

      const tbody = document.createElement("tbody");
      merge.rows.slice(0, PREVIEW_LIMIT).forEach((row, ri) => {
        const tr = document.createElement("tr");
        const fi = merge.sources ? merge.sources[ri] : null;
        const col = fi != null ? usableColors[fi] : null;
        row.forEach((c, ci) => {
          const td = document.createElement("td");
          if ((c || "").trim() === "") { td.className = "empty-cell"; td.textContent = "فارغ"; }
          else { td.textContent = c; td.title = c; }
          if (col) {
            td.style.background = col.tint; // خلفية خفيفة بلون الملف المصدر
            if (ci === 0) { // شريط لون على حافة الصف (جهة البداية في RTL)
              td.style.borderInlineStartWidth = "4px";
              td.style.borderInlineStartStyle = "solid";
              td.style.borderInlineStartColor = col.solid;
            }
          }
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
    }
    const notes = [];
    if (!merge.includeHeader && merge.rows.length > 0) {
      notes.push("الملفات بدون صف عناوين — أسماء الأعمدة في المعاينة للعرض فقط ولن تُكتب في الملف الناتج.");
    }
    if (merge.rows.length > PREVIEW_LIMIT) {
      notes.push(`معاينة أول ${PREVIEW_LIMIT} صف من أصل ${merge.rows.length} — الملف المنزَّل يحتوي كل الصفوف.`);
    }
    $("previewNote").textContent = notes.join(" ");
    $("downloadBtn").disabled = merge.rows.length === 0 && merge.headers.length === 0;
  }

  // مفتاح ألوان الملفات فوق المعاينة
  function renderLegend(analyzed, colors) {
    const el = $("colorLegend");
    el.innerHTML = "";
    analyzed.forEach((a, i) => {
      if (a.empty) return;
      const item = document.createElement("span");
      item.className = "legend-item";
      const sw = document.createElement("span");
      sw.className = "legend-swatch";
      sw.style.background = colors[i].solid;
      item.appendChild(sw);
      item.appendChild(document.createTextNode(a.name));
      el.appendChild(item);
    });
  }

  /* ---------- معاينة الملفات ومحاذاة الأعمدة ---------- */

  function renderAlign(analyzed, colors) {
    const wrap = $("alignTables");
    wrap.innerHTML = "";
    const usable = analyzed.filter((a) => !a.empty);
    const N = align.finalCols.length;
    // لا معنى للمحاذاة بلا ملفات أو بلا أعمدة ناتج
    if (usable.length === 0 || N === 0) { $("alignSection").hidden = true; return; }
    $("alignSection").hidden = false;
    $("alignResetBtn").disabled = !align.active;

    const usableColors = usableColorsOf(analyzed, colors);

    // صف مرجعي: أعمدة الناتج (الأعمدة المتناظرة تظهر فوق جداول الملفات)
    const refBlock = document.createElement("div");
    refBlock.className = "align-block";
    const refLabel = document.createElement("div");
    refLabel.className = "align-block-label align-ref-label";
    refLabel.textContent = "أعمدة الناتج";
    refBlock.appendChild(refLabel);
    const refTable = document.createElement("table");
    refTable.className = "align-table align-ref";
    const refHead = document.createElement("thead");
    const refTr = document.createElement("tr");
    align.headers.forEach((h) => {
      const th = document.createElement("th");
      th.textContent = h;
      refTr.appendChild(th);
    });
    refHead.appendChild(refTr);
    refTable.appendChild(refHead);
    refBlock.appendChild(refTable);
    wrap.appendChild(refBlock);

    // جدول مصغّر لكل ملف — رؤوسه قابلة للسحب لتعديل خريطة هذا الملف فقط
    usable.forEach((f, fi) => {
      const color = usableColors[fi];
      const map = align.maps[fi] || [];
      const block = document.createElement("div");
      block.className = "align-block align-file";
      block.style.setProperty("--file-color", color.solid);

      const label = document.createElement("div");
      label.className = "align-block-label";
      const dot = document.createElement("span");
      dot.className = "legend-swatch";
      dot.style.background = color.solid;
      label.appendChild(dot);
      label.appendChild(document.createTextNode(f.name));
      block.appendChild(label);

      const t = document.createElement("table");
      t.className = "align-table";
      const thead = document.createElement("thead");
      const tr = document.createElement("tr");
      const cells = [];
      for (let p = 0; p < N; p++) {
        const th = document.createElement("th");
        th.dataset.col = p;
        th.classList.add("th-draggable");
        th.title = "اسحب لتغيير العمود الذي يقع تحت هذا العمود من الناتج";
        const srcIdx = map[p];
        if (srcIdx == null) { th.textContent = "—"; th.classList.add("align-empty-col"); }
        else th.textContent = f.hasHeader ? f.headers[srcIdx] : `عمود ${srcIdx + 1}`;
        tr.appendChild(th);
        cells.push(th);
      }
      thead.appendChild(tr);
      t.appendChild(thead);

      const tbody = document.createElement("tbody");
      f.dataRows.slice(0, 3).forEach((raw) => {
        const dtr = document.createElement("tr");
        for (let p = 0; p < N; p++) {
          const td = document.createElement("td");
          const srcIdx = map[p];
          const v = srcIdx == null ? "" : (raw[srcIdx] == null ? "" : raw[srcIdx]);
          if (String(v).trim() === "") { td.className = "empty-cell"; td.textContent = "—"; }
          else { td.textContent = v; td.title = v; }
          dtr.appendChild(td);
        }
        tbody.appendChild(dtr);
      });
      t.appendChild(tbody);
      block.appendChild(t);
      enableColDrag(cells, (from, to) => moveFileColumn(fi, from, to));
      wrap.appendChild(block);
    });
  }

  /* ---------- التنزيل ---------- */

  function download() {
    if (!lastMerge) return;
    // إن كانت كل الملفات بدون صف عناوين فلا يُكتب صف عناوين في الناتج
    const csv = toCSV(lastMerge.includeHeader ? lastMerge.headers : null, lastMerge.rows, ",");
    // BOM حتى يفتح Excel الملف بالحروف العربية الصحيحة
    const blob = new Blob([String.fromCharCode(0xFEFF) + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "merged.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  /* ---------- بيانات تجريبية ---------- */

  function loadDemo() {
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
    const demo2 =
      "البريد,الاسم,العمر,المدينة,الهاتف\n" +
      "hassan@mail.com,حسن إبراهيم,38,الدوحة,0501234567\n" +
      "fatma@mail.com,فاطمة عادل,27,الكويت,0559876543\n" +
      "\n" +
      "البريد,الاسم,العمر,المدينة,الهاتف\n" +
      "yousef@mail.com,يوسف ماهر,45,مسقط,0561112223\n" +
      "sara@mail.com,سارة محمد,28,جدة,0574445556\n";

    // ملف بدون صف عناوين — بنفس ترتيب أعمدة الملف الأول
    const demo3 =
      "سامي رشيد,sami@mail.com,تونس,33\n" +
      "هدى عزيز,huda@mail.com,الرباط,30\n" +
      "كمال نبيل,kamal@mail.com,الجزائر,37\n";

    state.files = [
      { id: fileSeq++, name: "عملاء-الفرع-الأول.csv", size: new Blob([demo1]).size, text: demo1, encodingNote: null, hasHeaderOverride: null },
      { id: fileSeq++, name: "عملاء-الفرع-الثاني.csv", size: new Blob([demo2]).size, text: demo2, encodingNote: null, hasHeaderOverride: null },
      { id: fileSeq++, name: "عملاء-بدون-عناوين.csv", size: new Blob([demo3]).size, text: demo3, encodingNote: null, hasHeaderOverride: null },
    ];
    render();
    $("issuesSection").scrollIntoView({ behavior: "smooth" });
  }

  /* ---------- ربط الأحداث ---------- */

  $("pickBtn").addEventListener("click", (e) => { e.stopPropagation(); fileInput.click(); });
  $("demoBtn").addEventListener("click", (e) => { e.stopPropagation(); loadDemo(); });
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") fileInput.click(); });
  fileInput.addEventListener("change", () => { addFiles([...fileInput.files]); fileInput.value = ""; });

  ["dragenter", "dragover"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("dragover"); })
  );
  ["dragleave", "drop"].forEach((ev) =>
    dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("dragover"); })
  );
  dropzone.addEventListener("drop", (e) => addFiles([...e.dataTransfer.files]));

  // إعادة التحليل عند تغيير أي خيار
  ["optColumnMode", "optSkipEmpty", "optDropDupes", "optCaseInsensitive", "optAddSource"]
    .forEach((id) => $(id).addEventListener("change", render));

  $("clearBtn").addEventListener("click", () => { state.files = []; render(); });
  $("alignResetBtn").addEventListener("click", resetAlign);
  $("downloadBtn").addEventListener("click", download);
}

/* تصدير للاختبار في Node — لا تأثير له داخل المتصفح */
if (typeof module !== "undefined" && module.exports) {
  module.exports = { parseCSV, detectDelimiter, classifyValue, detectHasHeader, analyzeFile, crossFileChecks, buildMerge, toCSV, csvEscape, planColumns, defaultFileMap, autoMergePlan, mergeWithMaps };
}
