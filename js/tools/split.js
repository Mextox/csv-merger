"use strict";
/* أداة التقسيم والتصدير: أخذ مدى من كروت ملف جاهز وتقسيمه، وسحب كمية بقالب Batch، وإضافة نص لنهاية الأسطر.
 * الملف الأصلي لا يُعدَّل أبدًا — المتبقي يُنزَّل كملف مستقل ليحلّ محله عندك. */
(function () {
  const T = globalThis.Tamim;
  const { el, clear, formatSize, download, dropzone, dialog, toast } = T.app.ui;
  const { store, workspace } = T.app;
  const S = T.core.split;

  const root = document.getElementById("splitRoot");
  if (!root) return;

  const state = {
    templates: [],
    take: { files: [], opts: { mode: "last", lastLines: 0, startLine: 1, count: 0, splitSize: 0, customName: "", startNumber: 1, swapFirstTwo: false, protectColumns: true, templateId: "", categoryName: "" }, result: null },
    pull: { files: [], result: null },
    append: { files: [], text: "", result: null },
  };

  const codeTemplates = () => state.templates.filter((t) => t.kind === "codes");
  const batchTemplates = () => state.templates.filter((t) => t.kind === "batch");

  async function loadTemplates() {
    try { state.templates = (await store.all("templates")).sort((a, b) => a.name.localeCompare(b.name, "ar")); }
    catch (e) { state.templates = []; }
  }

  async function readAsText(f) {
    const { text } = await T.core.csv.readFileSmart(f);
    return { id: Math.random().toString(36).slice(2), name: f.name, size: f.size, text };
  }

  /* ---------- 1) أخذ وتقسيم ---------- */

  function takeCodes() {
    const t = codeTemplates().find((x) => x.id === state.take.opts.templateId);
    if (!t) return [];
    const cat = (t.categories || []).find((c) => c.name === state.take.opts.categoryName);
    return cat ? [String(t.code), String(cat.code)] : [];
  }

  function runTake() {
    const o = state.take.opts;
    const codes = takeCodes();
    if (o.templateId && !codes.length) { toast("اختر الفئة من التمبلت أولًا", "error"); return; }
    const files = state.take.files.map((f) => {
      const r = S.takeLines(f.text, {
        lastLines: o.mode === "last" ? o.lastLines : 0,
        startLine: o.startLine, count: o.count,
        protectColumns: o.protectColumns, swapFirstTwo: o.swapFirstTwo, codes,
      });
      const parts = S.buildParts(r.taken, { splitSize: o.splitSize, customName: state.take.files.length === 1 ? o.customName : "", sourceName: f.name, startNumber: o.startNumber });
      return { file: f, r, parts };
    });
    state.take.result = { files, codes };
    render();
  }

  function takeDownload() {
    const all = state.take.result.files.flatMap((x) => x.parts);
    if (all.length === 1) download(all[0].name, all[0].text, "text/csv");
    else download(`tamim-split-${T.app.ui.today()}.zip`, T.core.zip.buildZip(all.map((p) => ({ name: p.path, data: new TextEncoder().encode(p.text) }))), "application/zip");
  }

  function takeDownloadRest() {
    const rest = state.take.result.files.filter((x) => x.r.remaining.length);
    if (!rest.length) { toast("لا يوجد متبقٍ", "error"); return; }
    if (rest.length === 1) download(rest[0].file.name, rest[0].r.remaining.join("\n"), "text/csv");
    else download(`tamim-remaining-${T.app.ui.today()}.zip`, T.core.zip.buildZip(rest.map((x) => ({ name: x.file.name, data: new TextEncoder().encode(x.r.remaining.join("\n")) }))), "application/zip");
  }

  function takeToWorkspace() {
    state.take.result.files.forEach((x) => x.parts.forEach((p) => workspace.add({
      name: p.path, header: null, rows: S.toLines(p.text).map((l) => l.split(",")), origin: { tool: "split", files: [x.file.name] },
    })));
    toast("أُرسلت الأجزاء إلى سلة العمل", "ok");
  }

  /* ---------- 2) سحب كمية بقالب ---------- */

  function pullInfo(f) {
    const p = S.pullQuantity(f.text, f.qty || 0);
    const tpl = S.templateFor(batchTemplates(), p.categoryCode);
    return { p, tpl };
  }

  function runPull() {
    const files = state.pull.files.map((f) => {
      const { p, tpl } = pullInfo(f);
      return { file: f, p, tpl, text: tpl && p.taken.length ? S.batchExport(p.taken, tpl) : "" };
    });
    const missing = files.filter((x) => !x.tpl);
    state.pull.result = { files, missing };
    render();
  }

  function pullDownload() {
    const ok = state.pull.result.files.filter((x) => x.text);
    const entries = [];
    ok.forEach((x) => {
      const base = x.file.name.replace(/\.[^.]+$/, "");
      entries.push({ name: `export/${base}_1.csv`, data: new TextEncoder().encode(x.text) });
      entries.push({ name: `remaining/${x.file.name}`, data: new TextEncoder().encode(S.rowsToText(x.p.remaining)) });
    });
    if (!entries.length) { toast("لا يوجد ما يُنزَّل", "error"); return; }
    download(`tamim-export-${T.app.ui.today()}.zip`, T.core.zip.buildZip(entries), "application/zip");
  }

  /* ---------- 3) إضافة نص ---------- */

  function runAppend() {
    const text = state.append.text.trim();
    if (!text) { toast("اكتب النص المراد إضافته", "error"); return; }
    state.append.result = state.append.files.map((f) => ({ name: f.name, text: S.appendToLines(f.text, text) }));
    render();
  }

  function appendDownload() {
    const files = state.append.result;
    if (files.length === 1) download(files[0].name, files[0].text, "text/csv");
    else download(`tamim-appended-${T.app.ui.today()}.zip`, T.core.zip.buildZip(files.map((f) => ({ name: f.name, data: new TextEncoder().encode(f.text) }))), "application/zip");
  }

  /* ---------- الواجهة ---------- */

  const field = (label, control, hint) => el("label", { class: "t-field" }, el("span", { class: "t-field-label", text: label }), control, hint ? el("small", { class: "t-field-hint", text: hint }) : null);
  const num = (value, onChange) => el("input", { type: "text", class: "t-input", dir: "ltr", inputmode: "numeric", value: String(value), oninput: (e) => onChange(Math.max(0, parseInt(e.target.value, 10) || 0)) });
  const fileList = (files, onRemove) => el("div", { class: "files-list" }, files.map((f) => el("div", { class: "file-card t-file-card" },
    el("span", { class: "file-icon", text: "📄" }),
    el("div", { class: "file-info" }, el("div", { class: "file-name" }, el("bdi", { text: f.name })),
      el("div", { class: "file-meta" }, el("span", { text: formatSize(f.size) }), el("span", { text: `${S.toLines(f.text).length} سطر` }))),
    el("button", { class: "file-remove", text: "✕", title: "إزالة", onclick: () => onRemove(f) }))));

  function takeCard() {
    const o = state.take.opts;
    const tpl = codeTemplates().find((x) => x.id === o.templateId);
    const zone = dropzone({
      title: "اسحب ملف الكروت (CSV) وأفلته هنا", accept: ".csv,.txt",
      onFiles: async (list) => { for (const f of list) state.take.files.push(await readAsText(f)); state.take.result = null; render(); },
    });
    const ws = workspace.list();
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "١) أخذ كروت من ملف وتقسيمها" })),
      state.take.files.length ? fileList(state.take.files, (f) => { state.take.files = state.take.files.filter((x) => x !== f); state.take.result = null; render(); }) : zone,
      ws.length ? el("p", { class: "align-hint" }, "أو من سلة العمل: ", ws.map((d) => el("button", { type: "button", class: "btn btn-ghost btn-sm", text: d.name, onclick: () => { state.take.files.push({ id: d.id, name: d.name.split("/").pop(), size: 0, text: S.rowsToText(d.rows) }); state.take.result = null; render(); } }))) : null,
      el("div", { class: "t-grid" },
        field("طريقة التحديد", el("select", { class: "t-select", onchange: (e) => { o.mode = e.target.value; state.take.result = null; render(); } },
          [["last", "آخر عدد من الأسطر"], ["range", "من سطر معيّن وعدد"]].map(([v, l]) => el("option", { value: v, selected: v === o.mode, text: l })))),
        o.mode === "last" ? field("عدد الأسطر الأخيرة", num(o.lastLines, (v) => { o.lastLines = v; state.take.result = null; })) : null,
        o.mode === "range" ? field("السطر الأول", num(o.startLine, (v) => { o.startLine = v || 1; state.take.result = null; })) : null,
        o.mode === "range" ? field("عدد الأسطر (0 = حتى النهاية)", num(o.count, (v) => { o.count = v; state.take.result = null; })) : null,
        field("تقسيم كل (0 = ملف واحد)", num(o.splitSize, (v) => { o.splitSize = v; state.take.result = null; })),
        field("اسم الملف المخصص", el("input", { type: "text", class: "t-input", value: o.customName, oninput: (e) => { o.customName = e.target.value; state.take.result = null; } }), "يُستخدم عند اختيار ملف واحد"),
        field("رقم أول ملف", num(o.startNumber, (v) => { o.startNumber = v || 1; state.take.result = null; })),
        field("ترتيب الأعمدة", el("select", { class: "t-select", onchange: (e) => { o.swapFirstTwo = e.target.value === "swap"; state.take.result = null; } },
          [["keep", "كما هو (MAD)"], ["swap", "عكس أول عمودين (LBY)"]].map(([v, l]) => el("option", { value: v, selected: (v === "swap") === o.swapFirstTwo, text: l })))),
        el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", checked: o.protectColumns, onchange: (e) => { o.protectColumns = e.target.checked; state.take.result = null; render(); } }), " حماية الأعمدة (إبقاء كل الأعمدة)"),
        field("تمبلت الأكواد", el("select", { class: "t-select", onchange: (e) => { o.templateId = e.target.value; o.categoryName = ""; state.take.result = null; render(); } },
          [el("option", { value: "", text: "— بلا أكواد —" })].concat(codeTemplates().map((t) => el("option", { value: t.id, selected: t.id === o.templateId, text: `${t.name} (${t.code})` }))))),
        tpl ? field("الفئة", el("select", { class: "t-select", onchange: (e) => { o.categoryName = e.target.value; state.take.result = null; render(); } },
          [el("option", { value: "", text: "— اختر —" })].concat((tpl.categories || []).map((c) => el("option", { value: c.name, selected: c.name === o.categoryName, text: `${c.name} (${c.code})` }))))) : null),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "معاينة", disabled: !state.take.files.length, onclick: runTake })),
      state.take.result ? takeResult() : null);
  }

  function takeResult() {
    const r = state.take.result;
    const total = r.files.reduce((a, x) => a + x.r.taken.length, 0);
    const rest = r.files.reduce((a, x) => a + x.r.remaining.length, 0);
    const parts = r.files.flatMap((x) => x.parts);
    return el("div", { class: "t-result" },
      el("div", { class: "stats-row" },
        el("div", { class: "stat" }, el("b", { text: String(total) }), " سطر مأخوذ"),
        el("div", { class: "stat" }, el("b", { text: String(parts.length) }), " ملف ناتج"),
        el("div", { class: "stat" }, el("b", { text: String(rest) }), " سطر متبقٍ"),
        r.codes.length ? el("div", { class: "stat" }, el("b", { text: r.codes.join(",") }), " أكواد مضافة") : null),
      el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
        el("thead", {}, el("tr", {}, ["الملف الناتج", "عدد الأسطر", "أول سطر"].map((h) => el("th", { text: h })))),
        el("tbody", {}, parts.slice(0, 50).map((p) => el("tr", {},
          el("td", {}, el("bdi", { text: p.path })), el("td", { text: String(p.lines) }),
          el("td", { dir: "ltr", text: (p.text.split("\n")[0] || "").slice(0, 40) })))))),
      el("p", { class: "t-hint", text: "الملف الأصلي لم يتغيّر — نزّل «المتبقي» وضعه مكان الملف القديم إن أردت متابعة السحب منه لاحقًا." }),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: parts.length === 1 ? "⬇ تنزيل الملف" : "📦 تنزيل ZIP", disabled: !total, onclick: takeDownload }),
        el("button", { type: "button", class: "btn btn-ghost", text: "⬇ تنزيل المتبقي", disabled: !rest, onclick: takeDownloadRest }),
        el("button", { type: "button", class: "btn btn-ghost", text: "📥 إرسال إلى سلة العمل", disabled: !total, onclick: takeToWorkspace })));
  }

  function pullCard() {
    const zone = dropzone({
      title: "اسحب ملفات الكروت الجاهزة (CSV) وأفلتها هنا", accept: ".csv,.txt",
      onFiles: async (list) => { for (const f of list) { const x = await readAsText(f); x.qty = 0; state.pull.files.push(x); } state.pull.result = null; render(); },
    });
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "٢) سحب كمية وتصديرها بقالب" })),
      el("p", { class: "align-hint", text: "يأخذ آخر عدد تحدده من كل ملف، ويصدّره بقالب الفئة (رأس وذيل)، ويعطيك المتبقي في ملف مستقل." }),
      state.pull.files.length ? el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
        el("thead", {}, el("tr", {}, ["الملف", "عدد الكروت", "كود الفئة", "القالب", "الكمية المطلوبة", ""].map((h) => el("th", { text: h })))),
        el("tbody", {}, state.pull.files.map((f) => {
          const { p, tpl } = pullInfo(f);
          return el("tr", {},
            el("td", {}, el("bdi", { text: f.name })),
            el("td", { text: String(p.total) }),
            el("td", { dir: "ltr", text: p.categoryCode || "—" }),
            el("td", {}, tpl ? el("span", { class: "flag flag-ok", text: tpl.name }) : el("span", { class: "flag flag-error", text: "لا يوجد قالب" })),
            el("td", {}, num(f.qty || 0, (v) => { f.qty = Math.min(v, p.total); state.pull.result = null; })),
            el("td", {}, el("button", { class: "file-remove", text: "✕", onclick: () => { state.pull.files = state.pull.files.filter((x) => x !== f); state.pull.result = null; render(); } })));
        })))) : zone,
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "معاينة", disabled: !state.pull.files.length, onclick: runPull })),
      state.pull.result ? pullResult() : null);
  }

  function pullResult() {
    const r = state.pull.result;
    const ok = r.files.filter((x) => x.text);
    return el("div", { class: "t-result" },
      r.missing.length ? el("p", { class: "t-hint t-hint-error", text: `لا يوجد قالب تصدير لأكواد الفئات: ${[...new Set(r.missing.map((x) => x.p.categoryCode || "(فارغ)"))].join("، ")} — أضفه من الإعدادات.` }) : null,
      el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
        el("thead", {}, el("tr", {}, ["الملف", "المسحوب", "المتبقي", "القالب"].map((h) => el("th", { text: h })))),
        el("tbody", {}, r.files.map((x) => el("tr", {},
          el("td", {}, el("bdi", { text: x.file.name })), el("td", { text: String(x.p.taken.length) }),
          el("td", { text: String(x.p.remaining.length) }), el("td", { text: x.tpl ? x.tpl.name : "—" })))))),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "📦 تنزيل الملفات (تصدير + متبقٍ)", disabled: !ok.length, onclick: pullDownload })));
  }

  function appendCard() {
    const zone = dropzone({
      title: "اسحب الملفات التي تريد إضافة نص لنهاية أسطرها", accept: ".csv,.txt",
      onFiles: async (list) => { for (const f of list) state.append.files.push(await readAsText(f)); state.append.result = null; render(); },
    });
    return el("section", { class: "card" },
      el("div", { class: "card-head" }, el("h2", { text: "٣) إضافة نص لنهاية كل سطر" })),
      state.append.files.length ? fileList(state.append.files, (f) => { state.append.files = state.append.files.filter((x) => x !== f); state.append.result = null; render(); }) : zone,
      el("div", { class: "t-grid" }, field("النص المضاف بعد فاصلة", el("input", { type: "text", class: "t-input", dir: "ltr", value: state.append.text, oninput: (e) => { state.append.text = e.target.value; state.append.result = null; } }))),
      el("div", { class: "split-actions" },
        el("button", { type: "button", class: "btn btn-primary", text: "معاينة", disabled: !state.append.files.length, onclick: runAppend })),
      state.append.result ? el("div", { class: "t-result" },
        el("p", { class: "t-hint", text: `أول سطر بعد الإضافة: ${(state.append.result[0].text.split("\n")[0] || "").slice(0, 60)}` }),
        el("div", { class: "split-actions" }, el("button", { type: "button", class: "btn btn-primary", text: "⬇ تنزيل", onclick: appendDownload }))) : null);
  }

  function render() {
    clear(root);
    root.append(takeCard(), pullCard(), appendCard());
  }

  store.on((s) => { if (s === "templates") loadTemplates().then(render); });
  workspace.on(render);
  loadTemplates().then(render);
  render();
})();
