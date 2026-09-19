"use strict";
(function (factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require);
  } else {
    const T = (globalThis.Tamim = globalThis.Tamim || {});
    T.core = T.core || {};
    // "./csv.js" ← T.core.csv — نفس سطر require يعمل في المتصفح وفي Node
    T.core.merge = factory((p) => T.core[p.replace(/^.*\//, "").replace(/\.js$/, "")]);
  }
})(function (require) {
const { normalizeHeader, SEP } = require("./csv.js");

/* ---------- الدمج ---------- */

const POS_PREFIX = String.fromCharCode(0) + "pos_"; // مفتاح خاص للأعمدة الموضعية حتى لا يتصادم مع أسماء أعمدة حقيقية

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

/* =====================================================================
 * التقسيم حسب الشركات + حذف الأعمدة + كاتب ZIP (كلها دوال نقيّة قابلة للاختبار)
 * ===================================================================== */

/* ---------- حذف أعمدة الناتج ---------- */

// يزيل من الخطة أعمدة الناتج التي مفاتيحها ضمن deleted (Set أو مصفوفة مفاتيح finalCols).
// يعيد خطة جديدة (finalCols/headers/maps) دون تعديل الأصل — تُستخدم للدمج والتنزيل والتقسيم.
function filterDeletedColumns(plan, deleted) {
  const del = deleted instanceof Set ? deleted : new Set(deleted || []);
  const keep = [];
  plan.finalCols.forEach((k, i) => { if (!del.has(k)) keep.push(i); });
  return {
    finalCols: keep.map((i) => plan.finalCols[i]),
    headers: keep.map((i) => plan.headers[i]),
    includeHeader: plan.includeHeader,
    maps: (plan.maps || []).map((m) => keep.map((i) => m[i])),
  };
}

// أعمدة ملف واحد بأعمدته الأصلية (للإخراج غير المدموج) مع استبعاد الأعمدة المحذوفة.
// deletedSrcCols: مجموعة فهارس أعمدة هذا الملف التي حُذفت. الملفات بلا رأس تبقى بلا صف عناوين (headers = null).
function sliceOwnColumns(file, rows, deletedSrcCols) {
  const del = deletedSrcCols instanceof Set ? deletedSrcCols : new Set(deletedSrcCols || []);
  const keep = [];
  for (let i = 0; i < file.headers.length; i++) if (!del.has(i)) keep.push(i);
  const headers = keep.map((i) => file.headers[i]);
  const outRows = rows.map((r) => keep.map((i) => (r[i] == null ? "" : r[i])));
  return { headers: file.hasHeader ? headers : null, rows: outRows };
}

/* ---------- توزيع الصفوف على الشركات ---------- */

// توزيع تسلسلي من أعلى كل فئة (ملف): الشركة الأولى تأخذ أول N صف، الثانية التي تليها، إلخ.
// files: [{ dataRows }]، companies: [{ name, merge, counts: number[] }] (counts[fileIndex] = عدد الصفوف).
// يُقصّ ما يتجاوز المتاح تلقائيًا. يعيد شرائح لكل شركة + المتبقي غير المُوزَّع لكل فئة.
function planSplit(files, companies) {
  const cursors = files.map(() => 0);
  const outCompanies = (companies || []).map((co) => {
    const slices = [];
    files.forEach((f, fi) => {
      const avail = f.dataRows.length - cursors[fi];
      const want = Math.max(0, Math.floor(Number((co.counts || [])[fi]) || 0));
      const take = Math.min(want, avail);
      if (take > 0) {
        slices.push({ fileIndex: fi, rows: f.dataRows.slice(cursors[fi], cursors[fi] + take) });
        cursors[fi] += take;
      }
    });
    return { name: co.name, merge: !!co.merge, slices };
  });
  const remainder = [];
  files.forEach((f, fi) => {
    if (cursors[fi] < f.dataRows.length) {
      remainder.push({ fileIndex: fi, rows: f.dataRows.slice(cursors[fi]) });
    }
  });
  return { companies: outCompanies, remainder };
}

// يدمج شرائح شركة واحدة في ناتج واحد باستخدام نفس منطق الدمج (الخرائط + قواعد صف العناوين).
// usable: الملفات القابلة للاستخدام بترتيبها، plan: خطة الأعمدة (بعد استبعاد المحذوف)، slices: [{ fileIndex, rows }].
function mergeSlices(usable, opts, plan, slices) {
  const byIndex = new Map();
  (slices || []).forEach((s) => byIndex.set(s.fileIndex, s.rows));
  const pseudo = usable.map((f, fi) =>
    Object.assign({}, f, { dataRows: byIndex.get(fi) || [], empty: false })
  );
  return mergeWithMaps(pseudo, opts, plan);
}

// اسم ملف CSV داخل الأرشيف: يزيل امتداد المصدر (حتى لو تلاه اسم الورقة مثل "كتاب.xlsx — بيانات")
// وينظّف المحارف غير الصالحة في أسماء الملفات ثم يفرض الامتداد .csv — المحتوى دائمًا CSV.
function csvEntryName(rawName) {
  let s = String(rawName || "").replace(/\.(csv|txt|xlsx|xlsm)(?=$| — )/i, "");
  s = s.replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-").trim();
  if (!s) s = "ملف";
  return s + ".csv";
}

return { POS_PREFIX, planColumns, defaultFileMap, autoMergePlan, assembleRows, mergeWithMaps, buildMerge, filterDeletedColumns, sliceOwnColumns, planSplit, mergeSlices, csvEntryName };
});
