"use strict";
/* واجهة الدمج والتقسيم — منقولة من app.js كما هي (الأسطر 1172–2154). */
(function () {
  const core = globalThis.Tamim.core;
  const { analyzeFile, analyzeRows, crossFileChecks, toCSV, readFileSmart, DELIM_NAMES } = core.csv;
  const { autoMergePlan, mergeWithMaps, filterDeletedColumns, sliceOwnColumns, planSplit, mergeSlices, csvEntryName } = core.merge;
  const { buildZip } = core.zip;
  const { parseXlsx, xlsxSheetsToFiles } = core.xlsx;

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
  // deleted = مجموعة مفاتيح أعمدة الناتج المحذوفة (تُستبعد من التنزيل والتقسيم، وتعود عند إعادة الضبط).
  const align = { signature: "", ok: false, includeHeader: true, finalCols: [], headers: [], maps: [], deleted: new Set() };

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
    align.deleted = new Set(); // تغيّر البُنية يُعيد كل الأعمدة المحذوفة
    align.active = false; // لا يوجد تخصيص يدوي بعد
  }

  // فهارس أعمدة الناتج غير المحذوفة (بترتيبها الحالي)
  function keptIndices() {
    const out = [];
    align.finalCols.forEach((k, i) => { if (!align.deleted.has(k)) out.push(i); });
    return out;
  }

  // خطة فعّالة = خطة المحاذاة الحالية بعد استبعاد الأعمدة المحذوفة (للدمج والتنزيل والتقسيم)
  function effectiveAlign() {
    return filterDeletedColumns(align, align.deleted);
  }

  // مجموعة فهارس أعمدة الملف fi التي تقابل أعمدة ناتج محذوفة (للإخراج غير المدموج)
  function deletedSrcColsFor(fi) {
    const set = new Set();
    align.finalCols.forEach((k, p) => {
      if (align.deleted.has(k)) {
        const src = align.maps[fi] ? align.maps[fi][p] : null;
        if (src != null) set.add(src);
      }
    });
    return set;
  }

  // حذف عمود ناتج (بفهرسه الكامل داخل align.finalCols)
  function deleteOutputColumn(fullIdx) {
    const key = align.finalCols[fullIdx];
    if (key == null) return;
    align.deleted.add(key);
    align.active = true;
    render();
  }

  /* ---------- حالة التقسيم حسب الشركات ---------- */

  // كل شركة: { name, merge, counts: number[] } — counts[usableIndex] عدد الصفوف من كل فئة.
  const split = { open: false, companies: [], dialog: null };

  function addCompany() {
    split.companies.push({ name: "", merge: true, counts: [] });
    render();
  }
  function removeCompany(i) {
    split.companies.splice(i, 1);
    render();
  }
  // يضمن أن طول counts يساوي عدد الفئات القابلة للاستخدام
  function normalizeCompanies(nUsable) {
    return split.companies.map((co) => {
      const counts = [];
      for (let i = 0; i < nUsable; i++) counts.push(Math.max(0, Math.floor(Number(co.counts[i]) || 0)));
      return { name: co.name, merge: !!co.merge, counts };
    });
  }
  // معاينة التوزيع الحية: المتاح لكل شركة قبل دورها + المتبقي لكل فئة بعد كل الشركات
  function splitView(usable, companies) {
    const cursors = usable.map(() => 0);
    const rows = companies.map((co) => {
      const avail = usable.map((f, fi) => f.dataRows.length - cursors[fi]);
      const take = usable.map((f, fi) => Math.min(Math.max(0, Math.floor(Number(co.counts[fi]) || 0)), avail[fi]));
      take.forEach((t, fi) => { cursors[fi] += t; });
      return { avail, take };
    });
    const remaining = usable.map((f, fi) => f.dataRows.length - cursors[fi]);
    return { rows, remaining };
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
      const isExcel = lower.endsWith(".xlsx") || lower.endsWith(".xlsm");
      const isCsv = lower.endsWith(".csv") || lower.endsWith(".txt") ||
        (f.type || "").includes("csv") || (f.type || "").includes("text");
      if (!isExcel && !isCsv) {
        alert(`"${f.name}" ليس ملف CSV أو Excel — الرجاء اختيار ملفات بامتداد .csv أو .xlsx`);
        continue;
      }
      if (state.files.some((x) => x.srcName === f.name && x.srcSize === f.size)) continue; // نفس الملف مضاف مسبقًا
      if (isExcel) {
        await addExcelFile(f);
      } else {
        const { text, fallback, encoding } = await readFileSmart(f);
        state.files.push({
          id: fileSeq++,
          kind: "csv",
          name: f.name,
          srcName: f.name,
          srcSize: f.size,
          size: f.size,
          text,
          hasHeaderOverride: null, // null = اكتشاف تلقائي
          encodingNote: fallback
            ? { severity: "info", file: f.name, message: `الملف "${f.name}" ليس بترميز UTF-8 — تم اكتشاف ترميز ${encoding} وتحويله تلقائيًا حتى لا تظهر الحروف العربية مشوهة.` }
            : null,
        });
      }
    }
    render();
  }

  // قراءة ملف Excel: كل ورقة غير فارغة تصبح فئة (ملف) مستقلة تمرّ بنفس مسار التحليل.
  async function addExcelFile(f) {
    let sheets;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      sheets = await parseXlsx(bytes);
    } catch (err) {
      const msg = err && err.arMessage ? err.arMessage : `تعذّرت قراءة ملف Excel "${f.name}" — تأكد أنه ملف .xlsx سليم.`;
      state.files.push({ id: fileSeq++, kind: "excel-error", name: f.name, srcName: f.name, srcSize: f.size, size: f.size, message: msg, hasHeaderOverride: null, encodingNote: null });
      return;
    }
    const files = xlsxSheetsToFiles(f.name, sheets);
    if (files.length === 0) {
      // كل الأوراق فارغة — أضف عنصرًا واحدًا حتى يرى المستخدم الملف (سيُعلَّم فارغًا)
      state.files.push({ id: fileSeq++, kind: "excel", name: f.name, srcName: f.name, srcSize: f.size, size: f.size, sheetName: sheets[0] ? sheets[0].sheetName : "", rows: [], hasHeaderOverride: null, encodingNote: null });
      return;
    }
    files.forEach((s) => {
      state.files.push({ id: fileSeq++, kind: "excel", name: s.name, srcName: f.name, srcSize: f.size, size: f.size, sheetName: s.sheetName, rows: s.rows, hasHeaderOverride: null, encodingNote: null });
    });
  }

  // تحليل عنصر واحد من state.files (CSV أو ورقة Excel أو خطأ Excel) — يستخدمه render والاستخراج معًا
  function analyzeOne(f, opts) {
    let a;
    if (f.kind === "excel-error") {
      a = { name: f.name, delimiter: null, excel: { sheetName: null }, headers: [], dataRows: [], issues: [{ severity: "error", file: f.name, message: f.message }], empty: true, hasHeader: true };
    } else if (f.kind === "excel") {
      a = analyzeRows(f.name, f.rows, opts, f.hasHeaderOverride, { excel: { sheetName: f.sheetName } });
    } else if (f.kind === "rows") {
      // عنصر من سلة العمل: صفوف جاهزة (الفاصل للعرض فقط)
      a = analyzeRows(f.name, f.rows, opts, f.hasHeaderOverride, { delimiter: "," });
    } else {
      a = analyzeFile(f.name, f.text, opts, f.hasHeaderOverride);
    }
    if (f.encodingNote) a.issues.push(f.encodingNote);
    a.size = f.size;
    return a;
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
    $("splitSection").hidden = !has || !split.open;
    if (!has) { lastMerge = null; align.signature = ""; return; }

    const opts = getOptions();

    // تحليل كل ملف (CSV أو ورقة Excel)
    const analyzed = state.files.map((f) => analyzeOne(f, opts));
    const colors = state.files.map((f) => colorFor(f.id));

    // أعِد بناء خرائط المحاذاة إن تغيّرت البُنية جوهريًا، وإلا احتفظ بتعديلات المستخدم
    syncAlign(analyzed, opts);

    // الخطة التلقائية (لرسائل الفحص المتعلقة بالأعمدة)، والدمج بالخرائط الحالية بعد استبعاد المحذوف
    const plan = autoMergePlan(analyzed, opts);
    const merge = align.ok
      ? mergeWithMaps(analyzed, opts, effectiveAlign())
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
    renderSplit(analyzed, colors);
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
      icon.textContent = a.excel ? "📊" : "📄";

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
        const parts = [`${formatSize(a.size)}`, `${a.rowCount} صف`, `${a.headers.length} عمود`];
        parts.push(a.excel ? `Excel · الورقة: ${a.excel.sheetName || "?"}` : `الفاصل: ${DELIM_NAMES[a.delimiter]}`);
        parts.forEach((t) => { const s = document.createElement("span"); s.textContent = t; meta.appendChild(s); });
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

    // معاينة الجدول — رؤوس أعمدة الناتج قابلة للسحب لإعادة الترتيب وللحذف، وكل صف بلون ملفه المصدر
    const table = $("previewTable");
    table.innerHTML = "";
    if (merge.headers.length > 0) {
      const keep = keptIndices();            // فهارس align الكاملة المقابلة لأعمدة المعاينة
      const draggableCount = keep.length;    // العمود الأخير (الملف المصدر) غير قابل للسحب أو الحذف
      const thead = document.createElement("thead");
      const trh = document.createElement("tr");
      const headerCells = [];
      merge.headers.forEach((h, ci) => {
        const th = document.createElement("th");
        if (!merge.includeHeader && ci < draggableCount) th.classList.add("th-generic");
        if (ci < draggableCount) {
          const fullIdx = keep[ci];
          th.classList.add("th-draggable");
          th.dataset.col = fullIdx; // فهرس كامل داخل align.finalCols
          th.title = "اسحب لإعادة ترتيب أعمدة الناتج";
          const label = document.createElement("span");
          label.textContent = h;
          const del = document.createElement("button");
          del.type = "button";
          del.className = "col-del";
          del.textContent = "✕";
          del.title = "حذف هذا العمود من الناتج والتقسيم";
          del.draggable = false;
          del.addEventListener("click", (e) => { e.stopPropagation(); deleteOutputColumn(fullIdx); });
          del.addEventListener("mousedown", (e) => e.stopPropagation());
          th.appendChild(label);
          th.appendChild(del);
          headerCells.push(th);
        } else {
          th.textContent = h;
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
    const keep = keptIndices();          // أعمدة الناتج غير المحذوفة (فهارس align الكاملة)
    const N = keep.length;
    // لا معنى للمحاذاة بلا ملفات أو بلا أعمدة ناتج
    if (usable.length === 0 || N === 0) { $("alignSection").hidden = true; return; }
    $("alignSection").hidden = false;
    $("alignResetBtn").disabled = !align.active;

    const usableColors = usableColorsOf(analyzed, colors);

    // صف مرجعي: أعمدة الناتج (الأعمدة المتناظرة تظهر فوق جداول الملفات) مع زر حذف لكل عمود
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
    keep.forEach((fullIdx) => {
      const th = document.createElement("th");
      const label = document.createElement("span");
      label.textContent = align.headers[fullIdx];
      const del = document.createElement("button");
      del.type = "button";
      del.className = "col-del";
      del.textContent = "✕";
      del.title = "حذف هذا العمود من الناتج والتقسيم";
      del.addEventListener("click", (e) => { e.stopPropagation(); deleteOutputColumn(fullIdx); });
      th.appendChild(label);
      th.appendChild(del);
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
      keep.forEach((fullIdx) => {
        const th = document.createElement("th");
        th.dataset.col = fullIdx; // فهرس كامل داخل الخريطة
        th.classList.add("th-draggable");
        th.title = "اسحب لتغيير العمود الذي يقع تحت هذا العمود من الناتج";
        const srcIdx = map[fullIdx];
        if (srcIdx == null) { th.textContent = "—"; th.classList.add("align-empty-col"); }
        else th.textContent = f.hasHeader ? f.headers[srcIdx] : `عمود ${srcIdx + 1}`;
        tr.appendChild(th);
        cells.push(th);
      });
      thead.appendChild(tr);
      t.appendChild(thead);

      const tbody = document.createElement("tbody");
      f.dataRows.slice(0, 3).forEach((raw) => {
        const dtr = document.createElement("tr");
        keep.forEach((fullIdx) => {
          const td = document.createElement("td");
          const srcIdx = map[fullIdx];
          const v = srcIdx == null ? "" : (raw[srcIdx] == null ? "" : raw[srcIdx]);
          if (String(v).trim() === "") { td.className = "empty-cell"; td.textContent = "—"; }
          else { td.textContent = v; td.title = v; }
          dtr.appendChild(td);
        });
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

  /* ---------- التقسيم حسب الشركات ---------- */

  function renderSplit(analyzed, colors) {
    const host = $("companiesList");
    if (!split.open) { host.innerHTML = ""; return; }
    host.innerHTML = "";
    const usable = analyzed.filter((a) => !a.empty);
    const usableColors = usableColorsOf(analyzed, colors);
    const remainEl = $("splitRemaining");

    if (usable.length === 0) {
      host.textContent = "لا توجد ملفات قابلة للتقسيم.";
      remainEl.innerHTML = "";
      $("extractBtn").disabled = true;
      return;
    }
    $("extractBtn").disabled = false;

    const inputs = []; // inputs[companyIdx][categoryIdx]
    const subs = [];   // subs[companyIdx][categoryIdx] — لصّاقة «المتاح» الحية تحت كل مدخل

    // تحديث العرض الحي: المتاح لكل مدخل (يتناقص مع الكتابة) + ملخص المتبقي لكل فئة — دون إعادة بناء الحقول (حفاظًا على التركيز)
    function updateLive() {
      const companies = normalizeCompanies(usable.length);
      const view = splitView(usable, companies);
      view.rows.forEach((r, ci) => {
        r.avail.forEach((av, fi) => {
          const inp = inputs[ci] && inputs[ci][fi];
          if (inp) inp.max = String(av);
          const sub = subs[ci] && subs[ci][fi];
          if (sub) {
            const left = av - r.take[fi];
            sub.textContent = `المتاح: ${left} صف`;
            const wanted = inp ? Math.max(0, Math.floor(Number(inp.value) || 0)) : 0;
            sub.classList.toggle("cat-over", wanted > av);
            if (wanted > av) sub.textContent = `المتاح: ${left} صف — العدد المكتوب يتجاوز المتاح (${av})`;
          }
        });
      });
      remainEl.innerHTML = "";
      const totalRemain = view.remaining.reduce((a, b) => a + b, 0);
      const title = document.createElement("span");
      title.className = "split-remain-title";
      title.textContent = totalRemain > 0
        ? `المتبقي غير المُوزَّع (${totalRemain} صف): `
        : "تم توزيع كل الصفوف على الشركات ✓";
      remainEl.appendChild(title);
      if (totalRemain > 0) {
        usable.forEach((f, fi) => {
          if (view.remaining[fi] <= 0) return;
          const chip = document.createElement("span");
          chip.className = "cat-chip";
          chip.style.setProperty("--file-color", usableColors[fi].solid);
          const nameB = document.createElement("bdi"); // عزل اتجاه الاسم حتى لا تختلط الأرقام اللاتينية بالعربية
          nameB.textContent = f.name;
          chip.appendChild(nameB);
          chip.appendChild(document.createTextNode(` — المتبقي: ${view.remaining[fi]} صف`));
          remainEl.appendChild(chip);
        });
      }
    }

    split.companies.forEach((co, ci) => {
      inputs[ci] = [];
      subs[ci] = [];
      if (!Array.isArray(co.counts)) co.counts = [];
      const card = document.createElement("div");
      card.className = "company-card";

      const head = document.createElement("div");
      head.className = "company-head";

      const nameInp = document.createElement("input");
      nameInp.type = "text";
      nameInp.className = "company-name";
      nameInp.placeholder = `اسم الشركة ${ci + 1}`;
      nameInp.value = co.name;
      nameInp.addEventListener("input", () => { co.name = nameInp.value; });

      const mergeLabel = document.createElement("label");
      mergeLabel.className = "opt-check company-merge";
      const mergeCb = document.createElement("input");
      mergeCb.type = "checkbox";
      mergeCb.checked = co.merge;
      mergeCb.addEventListener("change", () => { co.merge = mergeCb.checked; });
      mergeLabel.appendChild(mergeCb);
      mergeLabel.appendChild(document.createTextNode(" دمج في ملف واحد"));

      const rm = document.createElement("button");
      rm.type = "button";
      rm.className = "company-remove";
      rm.textContent = "✕ حذف الشركة";
      rm.title = "حذف هذه الشركة";
      rm.addEventListener("click", () => removeCompany(ci));

      head.appendChild(nameInp);
      head.appendChild(mergeLabel);
      head.appendChild(rm);
      card.appendChild(head);

      const grid = document.createElement("div");
      grid.className = "cat-grid";
      usable.forEach((f, fi) => {
        const cell = document.createElement("div");
        cell.className = "cat-cell";
        cell.style.setProperty("--file-color", usableColors[fi].solid);

        const nm = document.createElement("bdi"); // bdi: يعزل اتجاه الاسم (أسماء لاتينية/رقمية داخل واجهة عربية)
        nm.className = "cat-name";
        nm.textContent = f.name;
        const sub = document.createElement("span");
        sub.className = "cat-sub";
        sub.textContent = `المتاح: ${f.dataRows.length} صف`;

        const inp = document.createElement("input");
        inp.type = "number";
        inp.min = "0";
        inp.step = "1";
        inp.inputMode = "numeric";
        inp.className = "cat-input";
        inp.value = String(co.counts[fi] != null ? co.counts[fi] : 0);
        inp.addEventListener("input", () => {
          co.counts[fi] = Math.max(0, Math.floor(Number(inp.value) || 0));
          updateLive();
        });
        inp.addEventListener("change", () => {
          // عند الخروج من الحقل: تثبيت القيمة على عدد صحيح ضمن المتاح (max يحدَّث حيًّا في updateLive)
          const cap = Math.max(0, Math.floor(Number(inp.max) || 0));
          co.counts[fi] = Math.min(Math.max(0, Math.floor(Number(inp.value) || 0)), cap);
          inp.value = String(co.counts[fi]);
          updateLive();
        });
        inputs[ci][fi] = inp;
        subs[ci][fi] = sub;

        cell.appendChild(nm);
        cell.appendChild(sub);
        cell.appendChild(inp);
        grid.appendChild(cell);
      });
      card.appendChild(grid);
      host.appendChild(card);
    });
    updateLive();
  }

  // حوار داخل الصفحة للسؤال عن كيفية استخراج المتبقي
  function showRemainderDialog(totalRemain, cb) {
    const dlg = $("splitDialog");
    dlg.innerHTML = "";
    dlg.hidden = false;
    const msg = document.createElement("p");
    msg.className = "dialog-msg";
    msg.textContent = `لا تزال هناك ${totalRemain} صف لم تُحدَّد لها شركة — هل تريد استخراج المتبقي مدموجًا في ملف واحد أم بدون دمج؟`;
    const row = document.createElement("div");
    row.className = "dialog-actions";
    const mk = (text, cls, val) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = cls;
      b.textContent = text;
      b.addEventListener("click", () => { dlg.hidden = true; cb(val); });
      return b;
    };
    row.appendChild(mk("مدموجًا في ملف واحد", "btn btn-primary", "merge"));
    row.appendChild(mk("بدون دمج (ملف لكل فئة)", "btn btn-ghost", "separate"));
    row.appendChild(mk("إلغاء", "btn btn-ghost", null));
    dlg.appendChild(msg);
    dlg.appendChild(row);
    dlg.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  // يحلّل الحالة الحالية (نفس تحليل render) — لاستخدامه عند الاستخراج
  function analyzeCurrent(opts) {
    return state.files.map((f) => analyzeOne(f, opts));
  }

  function doExtract() {
    const opts = getOptions();
    const analyzed = analyzeCurrent(opts);
    const usable = analyzed.filter((a) => !a.empty);
    if (usable.length === 0) { alert("لا توجد ملفات قابلة للتقسيم."); return; }
    const companies = normalizeCompanies(usable.length);
    const view = splitView(usable, companies);
    const totalRemain = view.remaining.reduce((a, b) => a + b, 0);
    if (totalRemain > 0) {
      showRemainderDialog(totalRemain, (mode) => { if (mode) buildAndDownloadZip(mode); });
    } else {
      buildAndDownloadZip("merge"); // لا يوجد متبقٍ — الوضع غير مؤثر
    }
  }

  function buildAndDownloadZip(remainderMode) {
    const opts = getOptions();
    const analyzed = analyzeCurrent(opts);
    const usable = analyzed.filter((a) => !a.empty);
    const effPlan = effectiveAlign();
    const companies = normalizeCompanies(usable.length);
    const plan = planSplit(usable, companies);

    const enc = new TextEncoder();
    const BOM = String.fromCharCode(0xFEFF);
    const entries = [];
    const usedFolders = new Set();

    function folderName(raw, fallback) {
      let n = (raw || "").trim().replace(/[\/\\:*?"<>|\x00-\x1f]/g, "-");
      if (!n) n = fallback;
      const base = n;
      let k = 2;
      while (usedFolders.has(n)) n = `${base} (${k++})`;
      usedFolders.add(n);
      return n;
    }
    function addCSV(path, headers, rows) {
      const csv = toCSV(headers, rows, ",");
      entries.push({ name: path, data: enc.encode(BOM + csv) });
    }
    function addUnmerged(folder, slices) {
      const used = new Set();
      slices.forEach((s) => {
        const f = usable[s.fileIndex];
        const own = sliceOwnColumns(f, s.rows, deletedSrcColsFor(s.fileIndex));
        let name = csvEntryName(f.name);
        const base = name.slice(0, -4);
        let k = 2;
        while (used.has(name)) name = `${base} (${k++}).csv`;
        used.add(name);
        addCSV(`${folder}/${name}`, own.headers, own.rows);
      });
    }

    plan.companies.forEach((co, i) => {
      if (co.slices.length === 0) return; // لم تُخصَّص أي صفوف لهذه الشركة
      const folder = folderName(co.name, `شركة ${i + 1}`);
      if (co.merge) {
        const m = mergeSlices(usable, opts, effPlan, co.slices);
        addCSV(`${folder}/${folder}.csv`, m.includeHeader ? m.headers : null, m.rows);
      } else {
        addUnmerged(folder, co.slices);
      }
    });

    if (plan.remainder.length > 0) {
      const folder = folderName("المتبقي", "المتبقي");
      if (remainderMode === "merge") {
        const m = mergeSlices(usable, opts, effPlan, plan.remainder);
        addCSV(`${folder}/${folder}.csv`, m.includeHeader ? m.headers : null, m.rows);
      } else {
        addUnmerged(folder, plan.remainder);
      }
    }

    if (entries.length === 0) { alert("لا توجد صفوف للاستخراج — حدِّد عدد الصفوف لكل شركة."); return; }

    const zip = buildZip(entries);
    const blob = new Blob([zip], { type: "application/zip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "split.zip";
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

  $("clearBtn").addEventListener("click", () => { state.files = []; split.open = false; split.companies = []; render(); });
  $("alignResetBtn").addEventListener("click", resetAlign);
  $("downloadBtn").addEventListener("click", download);

  // التقسيم حسب الشركات
  $("splitToggleBtn").addEventListener("click", () => {
    split.open = !split.open;
    if (split.open && split.companies.length === 0) split.companies.push({ name: "", merge: true, counts: [] });
    render();
    if (split.open) $("splitSection").scrollIntoView({ behavior: "smooth" });
  });
  $("splitAddBtn").addEventListener("click", addCompany);
  $("extractBtn").addEventListener("click", doExtract);

  /* ---------- سلة العمل ---------- */

  // يضيف عنصرًا من سلة العمل كفئة (ملف) — dataset: { id, name, header|null, rows }
  function addDataset(ds) {
    if (state.files.some((x) => x.srcName === "workspace:" + ds.id)) return; // مضاف مسبقًا
    const rows = ds.header ? [ds.header].concat(ds.rows) : ds.rows;
    const size = rows.reduce((n, r) => n + r.reduce((m, c) => m + String(c).length + 1, 0), 0);
    state.files.push({ id: fileSeq++, kind: "rows", name: ds.name, srcName: "workspace:" + ds.id, srcSize: size, size, rows, hasHeaderOverride: !!ds.header, encodingNote: null });
    render();
  }

  const ws = globalThis.Tamim.app && globalThis.Tamim.app.workspace;
  const wsBtn = $("fromWorkspaceBtn");
  if (ws && wsBtn) {
    const syncBtn = () => { wsBtn.hidden = ws.list().length === 0; };
    ws.on(syncBtn);
    syncBtn();
    wsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const items = ws.list();
      const { el, dialog } = globalThis.Tamim.app.ui;
      const boxes = items.map((ds) => ({ ds, cb: el("input", { type: "checkbox", checked: true }) }));
      dialog({
        title: "إضافة من سلة العمل",
        body: el("div", {}, boxes.map(({ ds, cb }) => el("label", { class: "opt opt-check t-ws-pick" }, cb, " ", el("bdi", { dir: "ltr", text: ds.name }), ` — ${ds.rows.length} صف`))),
        actions: [{ label: "إضافة", value: true, kind: "primary" }, { label: "إلغاء", value: false }],
      }).then((ok) => { if (ok) boxes.filter((b) => b.cb.checked).forEach((b) => addDataset(b.ds)); });
    });
  }

  globalThis.Tamim.tools = globalThis.Tamim.tools || {};
  globalThis.Tamim.tools.merge = { addDataset };
}
})();
