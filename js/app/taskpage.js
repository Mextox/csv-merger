"use strict";
/* صفحة مهمة واحدة بخطوات مرقّمة — يستخدمها كل أداة، فتكون كلها بنفس الشكل:
 *   ١ اختر الملفات  ←  ٢ الإعدادات  ←  ٣ النتيجة وماذا ستنزّل
 * الخطوة لا تظهر حتى تكتمل التي قبلها، وقبل التنزيل تُذكر أسماء الملفات وعدد أسطرها. */
(function () {
  const T = (globalThis.Tamim = globalThis.Tamim || {});
  T.app = T.app || {};
  const { el, clear, formatSize, download, dropzone, toast } = T.app.ui;

  // حقل إدخال واحد حسب وصفه: { key, label, type, value, hint, options, min }
  function inputFor(field, value, onChange, ctx) {
    if (field.type === "select") {
      const options = typeof field.options === "function" ? field.options((ctx || {}).values || {}, ctx) : field.options;
      return el("select", { class: "t-select", onchange: (e) => onChange(e.target.value) },
        (options || []).map(([v, label]) => el("option", { value: v, selected: String(v) === String(value), text: label })));
    }
    if (field.type === "checkbox") {
      return el("label", { class: "opt opt-check" }, el("input", { type: "checkbox", checked: !!value, onchange: (e) => onChange(e.target.checked) }), " " + field.label);
    }
    if (field.type === "textarea") {
      return el("textarea", { class: "t-input t-textarea", rows: field.rows || 4, dir: field.dir || "ltr", placeholder: field.placeholder || "", oninput: (e) => onChange(e.target.value) }, value || "");
    }
    const numeric = field.type === "number";
    return el("input", {
      type: "text", class: "t-input", dir: field.dir || (numeric ? "ltr" : "auto"), inputmode: numeric ? "numeric" : null,
      value: value == null ? "" : String(value), placeholder: field.placeholder || "",
      oninput: (e) => onChange(numeric ? Math.max(field.min == null ? 0 : field.min, parseInt(e.target.value, 10) || 0) : e.target.value),
    });
  }

  function fieldRow(field, value, onChange, ctx) {
    if (field.type === "checkbox") return inputFor(field, value, onChange, ctx);
    return el("label", { class: "t-field" },
      el("span", { class: "t-field-label", text: field.label }),
      inputFor(field, value, onChange, ctx),
      field.hint ? el("small", { class: "t-field-hint", text: field.hint }) : null);
  }

  // خطوة مرقّمة: done = مكتملة (✓)، ready = متاحة الآن، وإلا تظهر باهتة مع سبب
  function step(n, title, state, body, note) {
    return el("section", { class: `card t-step t-step-${state}` },
      el("div", { class: "card-head" },
        el("h2", {}, el("span", { class: "t-step-num", text: state === "done" ? "✓" : String(n) }), " " + title),
        note ? el("span", { class: "t-step-note", text: note }) : null),
      body);
  }

  /* opts:
   *  { oldName, title, intro, accept, multiple, folder,
   *    fields: [field], advanced: [field], perFile: [field],
   *    run(files, values) -> { outputs: [{ name, text, lines, note }], summary: [string], issues: [{level,message}], workspace: [dataset] },
   *    actionLabel, outputNote } */
  function create(root, opts) {
    const state = { files: [], values: {}, result: null, showAdvanced: false };
    (opts.fields || []).concat(opts.advanced || []).forEach((f) => { state.values[f.key] = f.value; });

    async function addFiles(list) {
      for (const f of list) {
        const accepted = !opts.accept || opts.accept.split(",").some((ext) => f.name.toLowerCase().endsWith(ext.trim()));
        if (!accepted) continue;
        const { text } = await T.core.csv.readFileSmart(f);
        const item = { id: Math.random().toString(36).slice(2), name: f.name, size: f.size, text, values: {} };
        (opts.perFile || []).forEach((pf) => { item.values[pf.key] = typeof pf.value === "function" ? pf.value(item) : pf.value; });
        if (opts.onFileAdded) opts.onFileAdded(item, state);
        state.files.push(item);
        if (!opts.multiple) break;
      }
      state.result = null;
      render();
    }

    function runNow() {
      try {
        state.result = opts.run(state.files, state.values);
      } catch (e) {
        toast(e && e.message ? e.message : "تعذّر التجهيز", "error");
        return;
      }
      render();
      const res = root.querySelector(".t-step-result");
      if (res) res.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function downloadAll() {
      const outs = state.result.outputs;
      if (outs.length === 1) download(outs[0].name, outs[0].text, "text/csv");
      else download(`${opts.zipName || "tamim"}-${T.app.ui.today()}.zip`,
        T.core.zip.buildZip(outs.map((o) => ({ name: o.path || o.name, data: new TextEncoder().encode(o.text) }))), "application/zip");
    }

    function filesStep() {
      const zone = dropzone({ title: opts.dropTitle || "اسحب الملفات هنا أو اضغط للاختيار", accept: opts.accept, folder: opts.folder, onFiles: addFiles });
      // مراجع ثابتة: بعد نقل حقول الاختيار خارج منطقة الإفلات لا يصح البحث عنها بـ querySelector
      const inputs = [...zone.querySelectorAll("input[type=file]")];
      const list = el("div", { class: "files-list" }, state.files.map((f) => el("div", { class: "file-card t-file-card" },
        el("span", { class: "file-icon", text: "📄" }),
        el("div", { class: "file-info" },
          el("div", { class: "file-name" }, el("bdi", { dir: "ltr", text: f.name })),
          el("div", { class: "file-meta" }, el("span", { text: formatSize(f.size) }),
            el("span", { text: `${f.text.split(/\r?\n/).filter((l) => l.trim()).length} سطر` }),
            opts.fileNote ? el("span", { text: opts.fileNote(f) }) : null)),
        (opts.perFile || []).map((pf) => el("label", { class: "t-ask" }, pf.label + ":",
          inputFor(pf, f.values[pf.key], (v) => { f.values[pf.key] = v; state.result = null; renderQuiet(); }, state))),
        el("button", { class: "file-remove", text: "✕", title: "إزالة", onclick: () => { state.files = state.files.filter((x) => x !== f); state.result = null; render(); } }))));
      return step(1, opts.filesTitle || "اختر الملفات", state.files.length ? "done" : "ready",
        el("div", {}, state.files.length ? list : zone,
          state.files.length ? el("div", { class: "split-actions" },
            opts.multiple ? el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "+ إضافة ملفات أخرى", onclick: () => inputs[0].click() }) : null,
            opts.folder ? el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "+ إضافة مجلد", onclick: () => inputs[1].click() }) : null,
            el("button", { type: "button", class: "btn btn-ghost btn-sm", text: "🗑 ابدأ من جديد", onclick: () => { state.files = []; state.result = null; render(); } })) : null,
          state.files.length ? inputs : null),
        state.files.length ? `${state.files.length} ملف` : "");
    }

    function settingsStep() {
      if (!(opts.fields || []).length && !(opts.advanced || []).length) return null;
      const ready = state.files.length > 0;
      const body = el("div", {},
        el("div", { class: "t-grid" }, (opts.fields || []).filter((f) => !f.when || f.when(state.values, state)).map((f) =>
          fieldRow(f, state.values[f.key], (v) => { state.values[f.key] = v; state.result = null; if (f.rerender) render(); else renderQuiet(); }, state))),
        (opts.advanced || []).length ? el("details", { class: "t-advanced", open: state.showAdvanced, ontoggle: (e) => { state.showAdvanced = e.target.open; } },
          el("summary", { text: "خيارات متقدمة (نادرًا ما تحتاجها)" }),
          el("div", { class: "t-grid" }, opts.advanced.filter((f) => !f.when || f.when(state.values, state)).map((f) =>
            fieldRow(f, state.values[f.key], (v) => { state.values[f.key] = v; state.result = null; if (f.rerender) render(); else renderQuiet(); }, state)))) : null);
      return step(2, opts.settingsTitle || "الإعدادات", ready ? "ready" : "waiting", ready ? body : el("p", { class: "t-hint", text: "اختر الملفات أولًا." }));
    }

    function actionStep() {
      const n = (opts.fields || []).length || (opts.advanced || []).length ? 3 : 2;
      const ready = state.files.length > 0 && (!opts.canRun || opts.canRun(state.files, state.values));
      const why = !state.files.length ? "اختر الملفات أولًا." : (opts.whyNot ? opts.whyNot(state.files, state.values) : "أكمل الإعدادات.");
      if (!state.result) {
        return step(n, opts.actionTitle || "جهّز الملفات", ready ? "ready" : "waiting",
          el("div", {},
            ready ? null : el("p", { class: "t-hint", text: why }),
            el("div", { class: "split-actions" },
              el("button", { type: "button", class: "btn btn-primary btn-big", text: opts.actionLabel || "⚙ جهّز الملفات", disabled: !ready, onclick: runNow }))));
      }
      const r = state.result;
      const errors = (r.issues || []).filter((i) => i.level === "error");
      const body = el("div", { class: "t-step-result" },
        (r.summary || []).length ? el("ul", { class: "t-summary" }, r.summary.map((s) => el("li", { text: s }))) : null,
        (r.issues || []).length ? T.app.ui.issuesList(r.issues) : null,
        el("h4", { class: "t-out-title", text: "ستحصل على هذه الملفات:" }),
        el("div", { class: "table-wrap" }, el("table", { class: "t-table" },
          el("thead", {}, el("tr", {}, ["الملف", "عدد الأسطر", "ما هو"].map((h) => el("th", { text: h })))),
          el("tbody", {}, r.outputs.map((o) => el("tr", {},
            el("td", {}, el("bdi", { dir: "ltr", text: o.path || o.name })),
            el("td", { text: String(o.lines != null ? o.lines : o.text.split("\n").filter(Boolean).length) }),
            el("td", { text: o.note || "" })))))),
        opts.outputNote ? el("p", { class: "t-hint", text: opts.outputNote }) : null,
        el("div", { class: "split-actions" },
          el("button", { type: "button", class: "btn btn-primary btn-big", text: r.outputs.length === 1 ? "⬇ تنزيل الملف" : `📦 تنزيل الملفات (${r.outputs.length})`, disabled: !r.outputs.length || errors.length, onclick: downloadAll }),
          (r.workspace || []).length ? el("button", { type: "button", class: "btn btn-ghost", text: "📥 إرسال إلى سلة العمل", disabled: errors.length > 0, onclick: () => { r.workspace.forEach((d) => T.app.workspace.add(d)); toast("أُرسل إلى سلة العمل", "ok"); } }) : null,
          el("button", { type: "button", class: "btn btn-ghost", text: "↺ تعديل الإعدادات", onclick: () => { state.result = null; render(); } })));
      return step(n, "النتيجة", "done", body, `${r.outputs.length} ملف جاهز`);
    }

    // تحديث بلا إعادة بناء كاملة (حتى لا يضيع التركيز أثناء الكتابة)
    function renderQuiet() {
      const action = root.querySelector(".t-step:last-child");
      if (!action) return;
      const fresh = actionStep();
      if (fresh) root.replaceChild(fresh, action);
    }

    function render() {
      clear(root);
      root.appendChild(el("div", { class: "t-task-head" },
        el("h1", { class: "t-task-title", text: opts.title }),
        opts.oldName ? el("span", { class: "t-old-name", text: `يقابل برنامجك: ${opts.oldName}` }) : null,
        opts.intro ? el("p", { class: "t-task-intro", text: opts.intro }) : null));
      [filesStep(), settingsStep(), actionStep()].filter(Boolean).forEach((s) => root.appendChild(s));
      if (opts.extra) { const x = opts.extra(state, render); if (x) root.appendChild(x); }
    }

    render();
    return { state, render, addFiles };
  }

  T.app.taskPage = { create, step, fieldRow };
})();
