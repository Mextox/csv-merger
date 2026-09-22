"use strict";
/* أدوات السيريال: توليد أكواد سرية، توليد سيريال لملف أكواد، استخراج عمود،
 * الفلترة بالطول، المطابقة (مطابق/غير مطابق)، والبحث عن سيريالات داخل ملفات. */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, formatSize, download, dropzone, dialog, toast } = T.app.ui;
  const { store, workspace } = T.app;
  const S = T.core.serials;
  const CSV = T.core.csv;

  const root = document.getElementById("serialsRoot");
  if (!root) return;

  const state = {
    gen: { length: 12, count: 100, batch: "", type: "digits", result: null, historyCount: 0, error: "" },
    ser: { file: null, source: "", category: "", companyCode: "", classCode: "", result: null },
    col: { files: [], column: 2, result: null },
    len: { files: [], length: 12, result: null },
    match: { ref: null, data: null, result: null },
    find: { serials: "", files: [], result: null },
  };

  // بصمة الكود (SHA-512 مقصوصة) — لا نحفظ الأرقام السرية نفسها أبدًا
  const hashOf = (code) => {
    const bytes = T.core.crypto.sha512(new TextEncoder().encode(code));
    return [...bytes.slice(0, 16)].map((b) => b.toString(16).padStart(2, "0")).join("");
  };

  async function loadHistory() {
    try { state.gen.historyCount = (await store.all("codes")).length; state.gen.error = ""; }
    catch (e) { state.gen.historyCount = 0; state.gen.error = e.message; }
  }

  const readText = async (f) => ({ name: f.name, size: f.size, text: (await CSV.readFileSmart(f)).text });
  const rowsOf = (text) => CSV.parseCSV(text, ",").rows.filter((r) => r.some((c) => c !== ""));
  const toCsv = (rows, header) => CSV.toCSV(header || null, rows, ",");
  const baseName = (n) => n.replace(/\.[^.]+$/, "");

  const field = (label, control, hint) => el("label", { class: "t-field" }, el("span", { class: "t-field-label", text: label }), control, hint ? el("small", { class: "t-field-hint", text: hint }) : null);
  const txt = (value, onChange, attrs) => el("input", Object.assign({ type: "text", class: "t-input", value: value == null ? "" : String(value), oninput: (e) => onChange(e.target.value) }, attrs || {}));
  const num = (value, onChange) => txt(value, (v) => onChange(Math.max(0, parseInt(v, 10) || 0)), { dir: "ltr", inputmode: "numeric" });
  const filesCard = (files, onRemove) => el("div", { class: "files-list" }, files.map((f) => el("div", { class: "file-card t-file-card" },
    el("span", { class: "file-icon", text: "📄" }),
    el("div", { class: "file-info" }, el("div", { class: "file-name" }, el("bdi", { text: f.name })),
      el("div", { class: "file-meta" }, el("span", { text: formatSize(f.size) }), el("span", { text: `${rowsOf(f.text).length} صف` }))),
    el("button", { class: "file-remove", text: "✕", onclick: () => onRemove(f) }))));
  const picker = (title, onFiles) => dropzone({ title, accept: ".csv,.txt", onFiles: async (list) => { for (const f of list) await onFiles(await readText(f)); render(); } });

  /* ---------- 1) توليد أكواد سرية ---------- */

  async function runGenerate() {
    const g = state.gen;
    if (!g.batch.trim()) { toast("اكتب رقم الدفعة", "error"); return; }
    let known = new Set();
    try { known = new Set((await store.all("codes")).map((x) => x.id)); } catch (e) { /* بلا حفظ محلي: نكتفي بمنع التكرار داخل الدفعة */ }
    const r = S.generateCodes({ length: g.length, count: g.count, type: g.type, batch: g.batch.trim(), date: new Date(), known, hashOf });
    g.result = r;
    if (!r.complete) toast(r.message, "error");
    render();
  }

  async function saveAndDownload() {
    const r = state.gen.result;
    try {
      for (const key of r.newKeys) await store.put("codes", { id: key, at: new Date().toISOString() }, { keepMeta: true });
      await loadHistory();
    } catch (e) { toast("تعذّر حفظ سجل الأكواد: " + e.message, "error"); }
    download(`codes-${state.gen.batch.trim()}-${T.app.ui.today()}.csv`,
      toCsv(r.rows.map((x) => [x.code, x.serial]), ["الرقم السري", "السيريال نمبر"]) + "\r\n", "text/csv");
  }

  function genCard() {
    const g = state.gen;
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "١) توليد أكواد سرية" }),
        el("span", { class: "count-badge", text: `${g.historyCount} كود في السجل` })),
      el("p", { class: "align-hint", text: "الأكواد عشوائية بمستوى تشفيري، ولا تتكرر مع أي كود ولّدته من قبل على هذا الجهاز. يُحفظ في السجل بصمة الكود فقط، لا الكود نفسه." }),
      g.error ? el("p", { class: "t-hint t-hint-error", text: `سجل الأكواد غير متاح: ${g.error}` }) : null,
      el("div", { class: "t-grid" },
        field("طول الكود", num(g.length, (v) => { g.length = v; g.result = null; })),
        field("عدد الأكواد", num(g.count, (v) => { g.count = v; g.result = null; })),
        field("رقم الدفعة", txt(g.batch, (v) => { g.batch = v; g.result = null; }, { dir: "ltr" }), "يدخل في بداية السيريال"),
        field("نوع الأكواد", el("select", { class: "t-select", onchange: (e) => { g.type = e.target.value; g.result = null; } },
          [["digits", "أرقام فقط"], ["letters", "أحرف فقط"], ["both", "أرقام وأحرف"]].map(([v, l]) => el("option", { value: v, selected: v === g.type, text: l }))))),
      el("div", { class: "split-actions" }, el("button", { type: "button", class: "btn btn-primary", text: "توليد", onclick: runGenerate })),
      g.result ? el("div", { class: "t-result" },
        el("div", { class: "stats-row" },
          el("div", { class: "stat" }, el("b", { text: String(g.result.rows.length) }), " كود"),
          el("div", { class: "stat" }, el("b", { text: g.result.complete ? "مكتمل ✓" : "ناقص" }), "")),
        el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["الرقم السري", "السيريال نمبر"].map((h) => el("th", { text: h })))),
          el("tbody", {}, g.result.rows.slice(0, 5).map((x) => el("tr", {}, el("td", { dir: "ltr", text: x.code }), el("td", { dir: "ltr", text: x.serial })))))),
        el("p", { class: "t-hint", text: "معاينة أول 5 أكواد. التنزيل يحفظ بصماتها في السجل لمنع تكرارها مستقبلًا." }),
        el("div", { class: "split-actions" }, el("button", { type: "button", class: "btn btn-primary", text: "⬇ تنزيل وحفظ في السجل", onclick: saveAndDownload }))) : null);
  }

  /* ---------- 2) توليد سيريال لملف أكواد ---------- */

  function serCard() {
    const s = state.ser;
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "٢) إضافة سيريال وأكواد لملف أكواد جاهز" })),
      el("p", { class: "align-hint", text: "يضع السيريال في العمود الثاني (تاريخ_مصدر_تصنيف_رقم)، ثم كود الشركة وكود الفئة." }),
      s.file ? filesCard([s.file], () => { s.file = null; s.result = null; render(); }) : picker("اسحب ملف الأكواد (CSV بعمود واحد)", async (f) => { s.file = f; s.result = null; }),
      el("div", { class: "t-grid" },
        field("المصدر", txt(s.source, (v) => { s.source = v; s.result = null; }, { dir: "ltr" })),
        field("التصنيف", txt(s.category, (v) => { s.category = v; s.result = null; }, { dir: "ltr" })),
        field("كود الشركة", txt(s.companyCode, (v) => { s.companyCode = v; s.result = null; }, { dir: "ltr" })),
        field("كود الفئة", txt(s.classCode, (v) => { s.classCode = v; s.result = null; }, { dir: "ltr" }))),
      el("div", { class: "split-actions" }, el("button", {
        type: "button", class: "btn btn-primary", text: "معاينة", disabled: !s.file,
        onclick: () => {
          if (!s.source.trim() || !s.category.trim() || !s.companyCode.trim() || !s.classCode.trim()) { toast("املأ كل الحقول", "error"); return; }
          s.result = S.insertSerials(rowsOf(s.file.text), { date: new Date(), source: s.source.trim(), category: s.category.trim(), companyCode: s.companyCode.trim(), classCode: s.classCode.trim() });
          render();
        },
      })),
      s.result ? el("div", { class: "t-result" },
        el("p", { class: "t-hint", text: `${s.result.length} صف — أول صف: ${s.result[0].join(",")}` }),
        el("div", { class: "split-actions" },
          el("button", { type: "button", class: "btn btn-primary", text: "⬇ تنزيل", onclick: () => download(s.file.name, toCsv(s.result) + "\r\n", "text/csv") }),
          el("button", { type: "button", class: "btn btn-ghost", text: "📥 إرسال إلى سلة العمل", onclick: () => { workspace.add({ name: s.file.name, header: null, rows: s.result, origin: { tool: "serials", files: [s.file.name] } }); toast("أُرسل إلى سلة العمل", "ok"); } }))) : null);
  }

  /* ---------- 3) استخراج عمود + 4) الفلترة بالطول ---------- */

  function simpleCard(title, hint, st, controls, run, makeName) {
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: title })),
      el("p", { class: "align-hint", text: hint }),
      st.files.length ? filesCard(st.files, (f) => { st.files = st.files.filter((x) => x !== f); st.result = null; render(); })
        : picker("اسحب الملفات هنا", async (f) => { st.files.push(f); st.result = null; }),
      el("div", { class: "t-grid" }, controls),
      el("div", { class: "split-actions" }, el("button", { type: "button", class: "btn btn-primary", text: "معاينة", disabled: !st.files.length, onclick: run })),
      st.result ? el("div", { class: "t-result" },
        el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["الملف", "صفوف الأصل", "صفوف الناتج"].map((h) => el("th", { text: h })))),
          el("tbody", {}, st.result.map((x) => el("tr", {}, el("td", {}, el("bdi", { text: x.name })), el("td", { text: String(x.before) }), el("td", { text: String(x.rows.length) })))))),
        el("div", { class: "split-actions" }, el("button", {
          type: "button", class: "btn btn-primary", text: st.result.length === 1 ? "⬇ تنزيل" : "📦 تنزيل ZIP",
          onclick: () => {
            const outs = st.result.map((x) => ({ name: makeName(x.name), text: toCsv(x.rows) + "\r\n" }));
            if (outs.length === 1) download(outs[0].name, outs[0].text, "text/csv");
            else download(`tamim-${T.app.ui.today()}.zip`, T.core.zip.buildZip(outs.map((o) => ({ name: o.name, data: new TextEncoder().encode(o.text) }))), "application/zip");
          },
        }))) : null);
  }

  /* ---------- 5) المطابقة ---------- */

  function matchCard() {
    const m = state.match;
    const slot = (label, key) => el("div", {},
      el("h4", { text: label }),
      m[key] ? filesCard([m[key]], () => { m[key] = null; m.result = null; render(); })
        : picker(label, async (f) => { m[key] = f; m.result = null; }));
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "٥) المطابقة: مطابق وغير مطابق" })),
      el("p", { class: "align-hint", text: "يقارن كل صف في ملف البيانات بكل قيم ملف البحث، ويفصلها إلى ملفين." }),
      slot("ملف البحث (القيم المطلوبة)", "ref"),
      slot("ملف البيانات (المصدر)", "data"),
      el("div", { class: "split-actions" }, el("button", {
        type: "button", class: "btn btn-primary", text: "معاينة", disabled: !(m.ref && m.data),
        onclick: () => { m.result = S.matchSplit(rowsOf(m.data.text), S.searchValues(rowsOf(m.ref.text))); render(); },
      })),
      m.result ? el("div", { class: "t-result" },
        el("div", { class: "stats-row" },
          el("div", { class: "stat" }, el("b", { text: String(m.result.matched.length) }), " مطابق"),
          el("div", { class: "stat" }, el("b", { text: String(m.result.unmatched.length) }), " غير مطابق")),
        el("div", { class: "split-actions" },
          el("button", { type: "button", class: "btn btn-primary", text: "⬇ المطابق", disabled: !m.result.matched.length, onclick: () => download(`${baseName(m.data.name)}_matched.csv`, toCsv(m.result.matched) + "\r\n", "text/csv") }),
          el("button", { type: "button", class: "btn btn-ghost", text: "⬇ غير المطابق", disabled: !m.result.unmatched.length, onclick: () => download(`${baseName(m.data.name)}_unmatched.csv`, toCsv(m.result.unmatched) + "\r\n", "text/csv") }))) : null);
  }

  /* ---------- 6) البحث عن سيريالات داخل ملفات ---------- */

  function findCard() {
    const f = state.find;
    const zone = dropzone({
      title: "اسحب الملفات أو المجلد الذي تبحث داخله", accept: ".csv,.txt", folder: true,
      onFiles: async (list) => { for (const x of list) if (/\.(csv|txt)$/i.test(x.name)) f.files.push(await readText(x)); f.result = null; render(); },
    });
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "٦) البحث عن سيريالات داخل ملفات" })),
      el("p", { class: "align-hint", text: "ضع السيريالات (سطر لكل واحد) واختر الملفات — يستخرج السطر الكامل لكل سيريال، ويأخذ أطول سطر إن تكرر." }),
      el("textarea", { class: "t-input t-textarea", rows: 5, dir: "ltr", placeholder: "سيريال في كل سطر", oninput: (e) => { f.serials = e.target.value; f.result = null; } }, f.serials),
      f.files.length ? filesCard(f.files, (x) => { f.files = f.files.filter((y) => y !== x); f.result = null; render(); }) : zone,
      el("div", { class: "split-actions" }, el("button", {
        type: "button", class: "btn btn-primary", text: "بحث", disabled: !f.files.length,
        onclick: () => {
          const serials = S.parseSerialList(f.serials);
          if (!serials.length) { toast("ضع سيريالًا واحدًا على الأقل", "error"); return; }
          f.result = S.searchSerials(f.files.map((x) => ({ name: x.name, lines: x.text.split(/\r?\n/) })), serials);
          render();
        },
      })),
      f.result ? el("div", { class: "t-result" },
        el("div", { class: "stats-row" },
          el("div", { class: "stat" }, el("b", { text: String(f.result.rows.length) }), " وُجد"),
          el("div", { class: "stat" }, el("b", { text: String(f.result.missing.length) }), " لم يوجد"),
          el("div", { class: "stat" }, el("b", { text: String(f.files.length) }), " ملف فُحص")),
        f.result.missing.length ? el("p", { class: "t-hint t-hint-error", text: `لم توجد: ${f.result.missing.slice(0, 10).join("، ")}${f.result.missing.length > 10 ? "…" : ""}` }) : null,
        el("div", { class: "split-actions" },
          el("button", { type: "button", class: "btn btn-primary", text: "⬇ تنزيل النتائج", disabled: !f.result.rows.length, onclick: () => download(`found-${T.app.ui.today()}.csv`, f.result.rows.map((x) => x.line).join("\r\n") + "\r\n", "text/csv") }))) : null);
  }

  function render() {
    clear(root);
    root.append(
      genCard(),
      serCard(),
      simpleCard("٣) استخراج عمود من ملفات", "يأخذ عمودًا واحدًا من كل ملف (مثل عمود السيريال).", state.col,
        [field("رقم العمود (يبدأ من 1)", num(state.col.column, (v) => { state.col.column = v || 1; state.col.result = null; }))],
        () => { state.col.result = state.col.files.map((f) => { const rows = rowsOf(f.text); return { name: f.name, before: rows.length, rows: S.pickColumn(rows, state.col.column - 1) }; }); render(); },
        (n) => `${baseName(n)}_serial.csv`),
      simpleCard("٤) فلترة الأسطر حسب طول الرقم", "يُبقي الأسطر التي فيها خانة بطول معيّن.", state.len,
        [field("الطول المطلوب", num(state.len.length, (v) => { state.len.length = v; state.len.result = null; }))],
        () => { state.len.result = state.len.files.map((f) => { const rows = rowsOf(f.text); return { name: f.name, before: rows.length, rows: S.filterByLength(rows, state.len.length) }; }); render(); },
        (n) => `${baseName(n)}_extracted.csv`),
      matchCard(),
      findCard());
  }

  store.on((s) => { if (s === "codes") loadHistory().then(render); });
  loadHistory().then(render);
  render();
})();
